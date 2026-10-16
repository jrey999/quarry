import { parseManifest, type ParsedManifest } from './manifestParsing'
import { listRegisteredTables, registerTable, updateRegisteredTable } from './registry'
import { listSavedViews, createView, updateView } from './views'
import { fetchObject } from './s3'
import type { BucketConnection } from './sources'
import type { SourceManifest } from './sourceManifests'

export interface ResolvedTable {
  schemaName: string
  tableName: string
  connectionId: string
  key: string
}

export interface ResolvedView {
  schemaName: string
  viewName: string
  sql: string
}

export interface ResolvedManifest {
  tables: ResolvedTable[]
  views: ResolvedView[]
  errors: string[]
}

export interface ManifestApplyOutcome {
  tablesCreated: number
  tablesUpdated: number
  viewsCreated: number
  viewsUpdated: number
  errors: string[]
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of items) map.set(keyFn(item), item)
  return [...map.values()]
}

// Turns the manifest's declared sources/tables/views into concrete registrations,
// resolving each `source:` name against the caller's already-configured bucket
// connections. A source or table that can't be resolved is reported in `errors`
// rather than thrown — the rest of the manifest still applies.
export function resolveManifest(parsed: ParsedManifest, connections: BucketConnection[]): ResolvedManifest {
  const errors: string[] = []
  const sourceConnectionIds = new Map<string, string>()
  const declaredSourceNames = new Set(parsed.sources.map((s) => s.name))

  for (const source of parsed.sources) {
    const match = connections.find((c) => c.endpointHost === source.endpoint && c.bucket === source.bucket)
    if (!match) {
      errors.push(
        `No bucket connection configured for source "${source.name}" (bucket "${source.bucket}" at "${source.endpoint}") — add that bucket connection first.`,
      )
      continue
    }
    sourceConnectionIds.set(source.name, match.id)
  }

  const tables: ResolvedTable[] = []
  const views: ResolvedView[] = []

  for (const [schemaName, schema] of Object.entries(parsed.schemas)) {
    for (const table of schema.tables) {
      const connectionId = sourceConnectionIds.get(table.source)
      if (!connectionId) {
        // A source that was declared but failed to resolve already produced its own
        // error above — don't pile on a duplicate one for every table that uses it.
        if (!declaredSourceNames.has(table.source)) {
          errors.push(`Table "${schemaName}.${table.name}" references unknown or unresolved source "${table.source}".`)
        }
        continue
      }
      tables.push({ schemaName, tableName: table.name, connectionId, key: table.file })
    }
    for (const view of schema.views) {
      views.push({ schemaName, viewName: view.name, sql: view.sql })
    }
  }

  return {
    tables: dedupeBy(tables, (t) => `${t.schemaName}.${t.tableName}`),
    views: dedupeBy(views, (v) => `${v.schemaName}.${v.viewName}`),
    errors,
  }
}

// Applying the same manifest twice must not create duplicate registrations — an
// existing table/view (matched by schema + name) is updated in place, keeping its
// id, rather than appended again. Nothing is ever deleted here: an entry dropped
// from the manifest is left as-is, since silently removing a registration someone
// else may have added manually (or under the same schema) is a real footgun.
export function applyManifest(text: string, connections: BucketConnection[]): ManifestApplyOutcome {
  const parsed = parseManifest(text)
  const { tables, views, errors } = resolveManifest(parsed, connections)

  const existingTables = listRegisteredTables()
  const existingViews = listSavedViews()

  let tablesCreated = 0
  let tablesUpdated = 0
  let viewsCreated = 0
  let viewsUpdated = 0

  for (const t of tables) {
    const existing = existingTables.find((e) => e.schemaName === t.schemaName && e.tableName === t.tableName)
    if (existing) {
      updateRegisteredTable(existing.id, {
        schemaName: t.schemaName,
        tableName: t.tableName,
        connectionId: t.connectionId,
        key: t.key,
      })
      tablesUpdated++
    } else {
      registerTable({ schemaName: t.schemaName, tableName: t.tableName, connectionId: t.connectionId, key: t.key })
      tablesCreated++
    }
  }

  for (const v of views) {
    const existing = existingViews.find((e) => e.schemaName === v.schemaName && e.viewName === v.viewName)
    if (existing) {
      updateView(existing.id, { schemaName: v.schemaName, viewName: v.viewName, sql: v.sql })
      viewsUpdated++
    } else {
      createView({ schemaName: v.schemaName, viewName: v.viewName, sql: v.sql })
      viewsCreated++
    }
  }

  return { tablesCreated, tablesUpdated, viewsCreated, viewsUpdated, errors }
}

// For a 'reference' manifest (points at a file already sitting in a bucket), refresh
// re-fetches that file's current content and re-applies it the same way as a fresh import.
export async function refreshReferenceManifest(
  manifest: SourceManifest,
  connections: BucketConnection[],
): Promise<ManifestApplyOutcome> {
  if (manifest.kind !== 'reference' || !manifest.connectionId || !manifest.key) {
    throw new Error(`"${manifest.label}" is not a bucket-referenced manifest.`)
  }
  const conn = connections.find((c) => c.id === manifest.connectionId)
  if (!conn) throw new Error(`Bucket connection for source manifest "${manifest.label}" no longer exists.`)
  const bytes = await fetchObject(conn, manifest.key)
  const text = new TextDecoder().decode(bytes)
  return applyManifest(text, connections)
}

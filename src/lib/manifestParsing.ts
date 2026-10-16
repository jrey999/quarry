import { load } from 'js-yaml'

export interface ManifestSource {
  name: string
  endpoint: string
  bucket: string
}

export interface ManifestTable {
  name: string
  source: string
  file: string
}

export interface ManifestView {
  name: string
  sql: string
}

export interface ManifestSchema {
  tables: ManifestTable[]
  views: ManifestView[]
}

export interface ParsedManifest {
  sources: ManifestSource[]
  schemas: Record<string, ManifestSchema>
}

function fail(message: string): never {
  throw new Error(`Invalid source manifest: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`"${path}" must be a non-empty string`)
  return value
}

function parseSource(raw: unknown, index: number): ManifestSource {
  if (!isRecord(raw)) fail(`sources[${index}] must be a mapping`)
  return {
    name: expectString(raw.name, `sources[${index}].name`),
    endpoint: expectString(raw.endpoint, `sources[${index}].endpoint`),
    bucket: expectString(raw.bucket, `sources[${index}].bucket`),
  }
}

function parseTable(raw: unknown, path: string): ManifestTable {
  if (!isRecord(raw)) fail(`${path} must be a mapping`)
  return {
    name: expectString(raw.name, `${path}.name`),
    source: expectString(raw.source, `${path}.source`),
    file: expectString(raw.file, `${path}.file`),
  }
}

function parseView(raw: unknown, path: string): ManifestView {
  if (!isRecord(raw)) fail(`${path} must be a mapping`)
  return {
    name: expectString(raw.name, `${path}.name`),
    sql: expectString(raw.sql, `${path}.sql`),
  }
}

function parseSchema(raw: unknown, schemaName: string): ManifestSchema {
  if (!isRecord(raw)) fail(`schemas.${schemaName} must be a mapping`)
  const tablesRaw = raw.tables
  const viewsRaw = raw.views
  if (tablesRaw !== undefined && !Array.isArray(tablesRaw)) fail(`schemas.${schemaName}.tables must be a list`)
  if (viewsRaw !== undefined && !Array.isArray(viewsRaw)) fail(`schemas.${schemaName}.views must be a list`)

  return {
    tables: ((tablesRaw as unknown[]) ?? []).map((t, i) => parseTable(t, `schemas.${schemaName}.tables[${i}]`)),
    views: ((viewsRaw as unknown[]) ?? []).map((v, i) => parseView(v, `schemas.${schemaName}.views[${i}]`)),
  }
}

export function parseManifest(text: string): ParsedManifest {
  let doc: unknown
  try {
    doc = load(text)
  } catch (err) {
    fail(`could not parse YAML — ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!isRecord(doc)) fail('top level must be a mapping with "sources" and "schemas" keys')

  const sourcesRaw = doc.sources
  if (sourcesRaw !== undefined && !Array.isArray(sourcesRaw)) fail('"sources" must be a list')
  const sources = ((sourcesRaw as unknown[]) ?? []).map((s, i) => parseSource(s, i))

  const schemasRaw = doc.schemas
  if (schemasRaw !== undefined && !isRecord(schemasRaw)) fail('"schemas" must be a mapping of schema name to contents')
  const schemas: Record<string, ManifestSchema> = {}
  for (const [schemaName, schemaBody] of Object.entries((schemasRaw as Record<string, unknown>) ?? {})) {
    schemas[schemaName] = parseSchema(schemaBody, schemaName)
  }

  return { sources, schemas }
}

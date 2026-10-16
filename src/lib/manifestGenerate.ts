import { dump } from 'js-yaml'
import { isDataFileKey } from './s3'
import type { ManifestTable, ManifestView } from './manifestParsing'

export interface GenerateSourceYmlInput {
  keys: string[]
  sourceName: string
  endpoint: string
  bucket: string
}

const DEFAULT_SCHEMA = 'main'
const KEYWORD_SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/
const INTEGER_VALUE = /^(0|-?[1-9]\d*)$/

interface ParsedKey {
  key: string
  schema: string
  table: string
  keywords: Record<string, string>
}

function toIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+$/, '')
  if (cleaned === '') return 'unnamed'
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// `schema=` is the only reserved directory segment; every other `key=value` directory
// becomes a column carrying that static value. The table is always the filename.
function parseKey(key: string): ParsedKey {
  const segments = key.split('/')
  const filename = segments.pop() ?? key
  const keywords: Record<string, string> = {}
  let schema = DEFAULT_SCHEMA

  for (const segment of segments) {
    const match = KEYWORD_SEGMENT.exec(segment)
    if (!match) continue
    if (match[1] === 'schema') schema = toIdentifier(match[2])
    else keywords[match[1]] = match[2]
  }

  return { key, schema, table: toIdentifier(filename.replace(/\.(csv|parquet)$/i, '')), keywords }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

// A name built from the keyword values stays stable when files are added or removed;
// only a file with no keywords at all falls back to its position.
function derivedTableName(table: string, file: ParsedKey, position: number): string {
  const parts = Object.keys(file.keywords)
    .sort(compare)
    .map((k) => `${k}_${file.keywords[k]}`)
  if (parts.length === 0) return `${table}_${position}`
  return toIdentifier(`${table}_${parts.join('_')}`)
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name
  for (let n = 2; used.has(candidate); n++) candidate = `${name}_${n}`
  used.add(candidate)
  return candidate
}

// Each file in a multi-file group is selected with its keyword values and its bucket
// path as literal columns; UNION ALL BY NAME null-fills whichever columns a branch lacks.
function buildUnionSql(schema: string, entries: { name: string; file: ParsedKey }[]): string {
  const keywordNames = [...new Set(entries.flatMap((e) => Object.keys(e.file.keywords)))].sort(compare)
  // One type per column across the whole union, so no branch disagrees with another.
  const numeric = new Set(
    keywordNames.filter((k) =>
      entries.every((e) => {
        const value = e.file.keywords[k]
        return value === undefined || (INTEGER_VALUE.test(value) && Number.isSafeInteger(Number(value)))
      }),
    ),
  )

  return entries
    .map(({ name, file }) => {
      const literals = keywordNames
        .filter((k) => file.keywords[k] !== undefined)
        .map((k) => `${numeric.has(k) ? file.keywords[k] : sqlString(file.keywords[k])} AS "${k}"`)
      literals.push(`${sqlString(file.key)} AS "_quarry_bucket_path"`)
      return `SELECT ${literals.join(', ')}, * FROM ${schema}.${name}`
    })
    .join('\nUNION ALL BY NAME\n')
}

// Builds the bones of a source manifest from nothing but the object keys in a bucket.
// Files sharing a schema and table name become one view that unions them.
export function generateSourceYml({ keys, sourceName, endpoint, bucket }: GenerateSourceYmlInput): string {
  const bySchema = new Map<string, Map<string, ParsedKey[]>>()
  for (const key of keys) {
    if (!isDataFileKey(key)) continue
    const parsed = parseKey(key)
    const tables = bySchema.get(parsed.schema) ?? new Map<string, ParsedKey[]>()
    tables.set(parsed.table, [...(tables.get(parsed.table) ?? []), parsed])
    bySchema.set(parsed.schema, tables)
  }

  const schemas: Record<string, { tables: ManifestTable[]; views?: ManifestView[] }> = {}

  for (const schema of [...bySchema.keys()].sort(compare)) {
    const groups = bySchema.get(schema)!
    // Group names are claimed first so a derived per-file name can never shadow a view or table.
    const used = new Set(groups.keys())
    const tables: ManifestTable[] = []
    const views: ManifestView[] = []

    for (const table of [...groups.keys()].sort(compare)) {
      const files = [...groups.get(table)!].sort((a, b) => compare(a.key, b.key))
      if (files.length === 1) {
        tables.push({ name: table, source: sourceName, file: files[0].key })
        continue
      }

      const entries = files.map((file, i) => ({ name: uniqueName(derivedTableName(table, file, i + 1), used), file }))
      for (const { name, file } of entries) tables.push({ name, source: sourceName, file: file.key })
      views.push({ name: table, sql: buildUnionSql(schema, entries) })
    }

    tables.sort((a, b) => compare(a.name, b.name))
    schemas[schema] = views.length > 0 ? { tables, views } : { tables }
  }

  return dump({ sources: [{ name: sourceName, endpoint, bucket }], schemas }, { lineWidth: -1, noRefs: true })
}

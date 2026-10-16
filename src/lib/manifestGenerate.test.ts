import { describe, expect, it } from 'vitest'
import { generateSourceYml } from './manifestGenerate'
import { parseManifest } from './manifestParsing'
import { resolveManifest } from './manifestApply'

const base = { sourceName: 'lake', endpoint: 'nyc3.digitaloceanspaces.com', bucket: 'lake' }

function generate(keys: string[]) {
  const yaml = generateSourceYml({ ...base, keys })
  return { yaml, parsed: parseManifest(yaml) }
}

describe('generateSourceYml', () => {
  it('declares the source and one table per file, named after the filename', () => {
    const { parsed } = generate(['schema=nfl/players.parquet', 'schema=nfl/games.csv'])

    expect(parsed.sources).toEqual([{ name: 'lake', endpoint: base.endpoint, bucket: 'lake' }])
    expect(parsed.schemas.nfl.tables).toEqual([
      { name: 'games', source: 'lake', file: 'schema=nfl/games.csv' },
      { name: 'players', source: 'lake', file: 'schema=nfl/players.parquet' },
    ])
    expect(parsed.schemas.nfl.views).toEqual([])
  })

  it('defaults to the main schema when no schema= segment is present', () => {
    const { parsed } = generate(['raw/events.parquet'])
    expect(parsed.schemas.main.tables).toEqual([{ name: 'events', source: 'lake', file: 'raw/events.parquet' }])
  })

  it('sorts schemas and tables ascending regardless of input order', () => {
    const { parsed } = generate(['schema=b/z.parquet', 'schema=a/y.parquet', 'schema=a/x.parquet'])
    expect(Object.keys(parsed.schemas)).toEqual(['a', 'b'])
    expect(parsed.schemas.a.tables.map((t) => t.name)).toEqual(['x', 'y'])
  })

  it('ignores files that are not csv or parquet and the _quarry folder', () => {
    const { parsed } = generate(['schema=a/notes.txt', '_quarry/sources/main.yml', '_quarry/x.parquet', 'schema=a/t.parquet'])
    expect(parsed.schemas.a.tables.map((t) => t.name)).toEqual(['t'])
    expect(Object.keys(parsed.schemas)).toEqual(['a'])
  })

  it('unions files that share a schema and table, naming each from its keyword values', () => {
    const { parsed } = generate([
      'schema=sales/year=2024/orders.parquet',
      'schema=sales/year=2025/orders.parquet',
    ])

    expect(parsed.schemas.sales.tables).toEqual([
      { name: 'orders_year_2024', source: 'lake', file: 'schema=sales/year=2024/orders.parquet' },
      { name: 'orders_year_2025', source: 'lake', file: 'schema=sales/year=2025/orders.parquet' },
    ])
    expect(parsed.schemas.sales.views).toEqual([
      {
        name: 'orders',
        sql: [
          `SELECT 2024 AS "year", 'schema=sales/year=2024/orders.parquet' AS "_quarry_bucket_path", * FROM sales.orders_year_2024`,
          'UNION ALL BY NAME',
          `SELECT 2025 AS "year", 'schema=sales/year=2025/orders.parquet' AS "_quarry_bucket_path", * FROM sales.orders_year_2025`,
        ].join('\n'),
      },
    ])
  })

  it('selects only the keywords each file actually has, leaving the rest to BY NAME null-filling', () => {
    const { parsed } = generate(['schema=s/year=2024/t.parquet', 'schema=s/state=texas/t.parquet'])
    const sql = parsed.schemas.s.views[0].sql

    expect(sql).toContain(`SELECT 2024 AS "year", 'schema=s/year=2024/t.parquet' AS "_quarry_bucket_path", * FROM s.t_year_2024`)
    expect(sql).toContain(`SELECT 'texas' AS "state", 'schema=s/state=texas/t.parquet' AS "_quarry_bucket_path", * FROM s.t_state_texas`)
    expect(sql).toContain('UNION ALL BY NAME')
  })

  it('quotes a keyword column as text when any value in the union is not an integer', () => {
    const { parsed } = generate(['schema=s/season=2024/t.parquet', 'schema=s/season=2024-25/t.parquet'])
    expect(parsed.schemas.s.views[0].sql).toContain(`'2024' AS "season"`)
    expect(parsed.schemas.s.views[0].sql).toContain(`'2024-25' AS "season"`)
  })

  it('falls back to a numeric suffix for files with no keywords', () => {
    const { parsed } = generate(['a/schema=s/t.parquet', 'b/schema=s/t.parquet'])
    expect(parsed.schemas.s.tables.map((t) => t.name)).toEqual(['t_1', 't_2'])
    expect(parsed.schemas.s.views[0].name).toBe('t')
  })

  it('keeps per-file names unique when two files carry identical keywords', () => {
    const { parsed } = generate(['x/schema=s/year=2024/t.parquet', 'y/schema=s/year=2024/t.parquet'])
    expect(parsed.schemas.s.tables.map((t) => t.name)).toEqual(['t_year_2024', 't_year_2024_2'])
  })

  it('does not let a derived name shadow a real table or the union view', () => {
    const { parsed } = generate([
      'schema=s/year=2024/t.parquet',
      'schema=s/year=2025/t.parquet',
      'schema=s/t_year_2024.parquet',
    ])
    const names = parsed.schemas.s.tables.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('t_year_2024')
    expect(names).toContain('t_year_2024_2')
  })

  it('treats db= like any other keyword', () => {
    const { parsed } = generate(['db=prod/schema=s/t.parquet', 'db=dev/schema=s/t.parquet'])
    expect(parsed.schemas.s.views[0].sql).toContain(`'prod' AS "db"`)
  })

  it('emits a manifest that resolves cleanly against a matching bucket connection', () => {
    const { parsed } = generate(['schema=s/year=2024/t.parquet', 'schema=s/year=2025/t.parquet', 'schema=s/u.parquet'])
    const resolved = resolveManifest(parsed, [
      {
        id: 'c1',
        endpointHost: base.endpoint,
        bucket: base.bucket,
        region: 'nyc3',
        accessKeyId: 'k',
        secretAccessKey: 's',
      },
    ])
    expect(resolved.errors).toEqual([])
    expect(resolved.tables).toHaveLength(3)
    expect(resolved.views.map((v) => v.viewName)).toEqual(['t'])
  })

  it('produces an empty schemas map when the bucket has no usable files', () => {
    const { parsed } = generate([])
    expect(parsed.schemas).toEqual({})
    expect(parsed.sources).toHaveLength(1)
  })
})

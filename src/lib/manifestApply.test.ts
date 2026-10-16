import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyManifest, refreshReferenceManifest, resolveManifest } from './manifestApply'
import { parseManifest } from './manifestParsing'
import { listRegisteredTables } from './registry'
import { listSavedViews } from './views'
import type { BucketConnection } from './sources'
import type { SourceManifest } from './sourceManifests'

vi.mock('./s3', () => ({
  fetchObject: vi.fn(),
}))

function makeConnection(overrides: Partial<BucketConnection> = {}): BucketConnection {
  return {
    id: 'conn-1',
    endpointHost: 'nyc3.digitaloceanspaces.com',
    bucket: 'degenerate-cafe',
    region: 'nyc3',
    accessKeyId: 'fake',
    secretAccessKey: 'fake',
    ...overrides,
  }
}

const basicYaml = `
sources:
  - name: spaces_main
    endpoint: nyc3.digitaloceanspaces.com
    bucket: degenerate-cafe

schemas:
  nfl:
    tables:
      - name: players
        source: spaces_main
        file: espn/players.parquet
    views:
      - name: player_usage
        sql: SELECT * FROM nfl.players
`

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('resolveManifest', () => {
  it('resolves a table source against a matching bucket connection', () => {
    const parsed = parseManifest(basicYaml)
    const result = resolveManifest(parsed, [makeConnection()])

    expect(result.errors).toEqual([])
    expect(result.tables).toEqual([
      { schemaName: 'nfl', tableName: 'players', connectionId: 'conn-1', key: 'espn/players.parquet' },
    ])
    expect(result.views).toEqual([{ schemaName: 'nfl', viewName: 'player_usage', sql: 'SELECT * FROM nfl.players' }])
  })

  it('reports an error and skips tables when no connection matches a source', () => {
    const parsed = parseManifest(basicYaml)
    const result = resolveManifest(parsed, [])

    expect(result.tables).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/No bucket connection configured for source "spaces_main"/)
  })

  it('reports an error for a table referencing an unknown source name', () => {
    const yaml = `
schemas:
  nfl:
    tables:
      - name: players
        source: does_not_exist
        file: players.parquet
`
    const result = resolveManifest(parseManifest(yaml), [makeConnection()])
    expect(result.tables).toEqual([])
    expect(result.errors[0]).toMatch(/unknown or unresolved source "does_not_exist"/)
  })

  it('dedupes tables with the same schema + name, keeping the last one', () => {
    const yaml = `
sources:
  - name: main
    endpoint: nyc3.digitaloceanspaces.com
    bucket: degenerate-cafe
schemas:
  nfl:
    tables:
      - name: players
        source: main
        file: old.parquet
      - name: players
        source: main
        file: new.parquet
`
    const result = resolveManifest(parseManifest(yaml), [makeConnection()])
    expect(result.tables).toEqual([{ schemaName: 'nfl', tableName: 'players', connectionId: 'conn-1', key: 'new.parquet' }])
  })
})

describe('applyManifest', () => {
  it('creates new registered tables and views on first apply', () => {
    const outcome = applyManifest(basicYaml, [makeConnection()])

    expect(outcome).toEqual({ tablesCreated: 1, tablesUpdated: 0, viewsCreated: 1, viewsUpdated: 0, errors: [] })

    const tables = listRegisteredTables()
    expect(tables).toHaveLength(1)
    expect(tables[0]).toMatchObject({ schemaName: 'nfl', tableName: 'players', connectionId: 'conn-1', key: 'espn/players.parquet' })

    const views = listSavedViews()
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ schemaName: 'nfl', viewName: 'player_usage', sql: 'SELECT * FROM nfl.players' })
  })

  it('is idempotent — re-applying the identical manifest updates in place instead of duplicating', () => {
    applyManifest(basicYaml, [makeConnection()])
    const firstTableId = listRegisteredTables()[0].id
    const firstViewId = listSavedViews()[0].id

    const outcome = applyManifest(basicYaml, [makeConnection()])

    expect(outcome).toEqual({ tablesCreated: 0, tablesUpdated: 1, viewsCreated: 0, viewsUpdated: 1, errors: [] })
    expect(listRegisteredTables()).toHaveLength(1)
    expect(listSavedViews()).toHaveLength(1)
    expect(listRegisteredTables()[0].id).toBe(firstTableId)
    expect(listSavedViews()[0].id).toBe(firstViewId)
  })

  it('updates an existing table in place when its file path changes', () => {
    applyManifest(basicYaml, [makeConnection()])
    const originalId = listRegisteredTables()[0].id

    const updatedYaml = basicYaml.replace('espn/players.parquet', 'espn/players_v2.parquet')
    applyManifest(updatedYaml, [makeConnection()])

    const tables = listRegisteredTables()
    expect(tables).toHaveLength(1)
    expect(tables[0].id).toBe(originalId)
    expect(tables[0].key).toBe('espn/players_v2.parquet')
  })

  it('applies what it can resolve and reports the rest as errors, without throwing', () => {
    const yaml = `
sources:
  - name: spaces_main
    endpoint: nyc3.digitaloceanspaces.com
    bucket: degenerate-cafe
schemas:
  nfl:
    tables:
      - name: players
        source: spaces_main
        file: players.parquet
      - name: games
        source: unknown_source
        file: games.parquet
`
    const outcome = applyManifest(yaml, [makeConnection()])

    expect(outcome.tablesCreated).toBe(1)
    expect(outcome.errors).toHaveLength(1)
    expect(outcome.errors[0]).toMatch(/games.*unknown_source/)
    expect(listRegisteredTables()).toHaveLength(1)
  })

  it('propagates a parse error for malformed manifest text', () => {
    expect(() => applyManifest('sources: [unclosed', [makeConnection()])).toThrow(/Invalid source manifest/)
  })
})

describe('refreshReferenceManifest', () => {
  const referenceManifest: SourceManifest = {
    id: 'manifest-1',
    label: 'main',
    kind: 'reference',
    connectionId: 'conn-1',
    key: 'sources.yml',
  }

  it('fetches the current file content and re-applies it', async () => {
    const { fetchObject } = await import('./s3')
    vi.mocked(fetchObject).mockResolvedValue(new TextEncoder().encode(basicYaml))

    const outcome = await refreshReferenceManifest(referenceManifest, [makeConnection()])

    expect(fetchObject).toHaveBeenCalledWith(makeConnection(), 'sources.yml')
    expect(outcome.tablesCreated).toBe(1)
    expect(listRegisteredTables()).toHaveLength(1)
  })

  it('throws if the referenced bucket connection no longer exists', async () => {
    await expect(refreshReferenceManifest(referenceManifest, [])).rejects.toThrow(/no longer exists/)
  })

  it('throws if called on a non-reference manifest', async () => {
    const inline: SourceManifest = { id: 'm2', label: 'inline-one', kind: 'inline', content: basicYaml }
    await expect(refreshReferenceManifest(inline, [makeConnection()])).rejects.toThrow(/not a bucket-referenced manifest/)
  })
})

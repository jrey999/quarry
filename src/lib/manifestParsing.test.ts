import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifestParsing'

describe('parseManifest', () => {
  it('parses a full manifest with sources, tables, and views', () => {
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
        file: espn/sport=nfl/season=2026/players.parquet
      - name: games
        source: spaces_main
        file: espn/sport=nfl/season=2026/games.parquet
    views:
      - name: player_usage
        sql: SELECT * FROM nfl.players
`
    const parsed = parseManifest(yaml)

    expect(parsed.sources).toEqual([
      { name: 'spaces_main', endpoint: 'nyc3.digitaloceanspaces.com', bucket: 'degenerate-cafe' },
    ])
    expect(parsed.schemas.nfl.tables).toEqual([
      { name: 'players', source: 'spaces_main', file: 'espn/sport=nfl/season=2026/players.parquet' },
      { name: 'games', source: 'spaces_main', file: 'espn/sport=nfl/season=2026/games.parquet' },
    ])
    expect(parsed.schemas.nfl.views).toEqual([{ name: 'player_usage', sql: 'SELECT * FROM nfl.players' }])
  })

  it('parses a minimal manifest with nothing declared', () => {
    const parsed = parseManifest('{}')
    expect(parsed.sources).toEqual([])
    expect(parsed.schemas).toEqual({})
  })

  it('allows a schema with only tables', () => {
    const yaml = `
schemas:
  kalshi:
    tables:
      - name: events
        source: main
        file: events.parquet
`
    const parsed = parseManifest(yaml)
    expect(parsed.schemas.kalshi.tables).toHaveLength(1)
    expect(parsed.schemas.kalshi.views).toEqual([])
  })

  it('allows a schema with only views', () => {
    const yaml = `
schemas:
  kalshi:
    views:
      - name: my_view
        sql: SELECT 1
`
    const parsed = parseManifest(yaml)
    expect(parsed.schemas.kalshi.tables).toEqual([])
    expect(parsed.schemas.kalshi.views).toHaveLength(1)
  })

  it('throws a clear error on invalid YAML syntax', () => {
    expect(() => parseManifest('sources: [unclosed')).toThrow(/Invalid source manifest/)
  })

  it('throws when the top level is not a mapping', () => {
    expect(() => parseManifest('- just\n- a\n- list')).toThrow(/top level must be a mapping/)
  })

  it('throws when "sources" is not a list', () => {
    expect(() => parseManifest('sources:\n  name: not-a-list')).toThrow(/"sources" must be a list/)
  })

  it('throws when "schemas" is not a mapping', () => {
    expect(() => parseManifest('schemas:\n  - not\n  - a\n  - mapping')).toThrow(/"schemas" must be a mapping/)
  })

  it('throws when a source is missing a required field', () => {
    const yaml = `
sources:
  - name: spaces_main
    endpoint: nyc3.digitaloceanspaces.com
`
    expect(() => parseManifest(yaml)).toThrow(/sources\[0\]\.bucket/)
  })

  it('throws when a table is missing a required field', () => {
    const yaml = `
schemas:
  nfl:
    tables:
      - name: players
        file: players.parquet
`
    expect(() => parseManifest(yaml)).toThrow(/tables\[0\]\.source/)
  })

  it('throws when a view is missing a required field', () => {
    const yaml = `
schemas:
  nfl:
    views:
      - name: my_view
`
    expect(() => parseManifest(yaml)).toThrow(/views\[0\]\.sql/)
  })
})

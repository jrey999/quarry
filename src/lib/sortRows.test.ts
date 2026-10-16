import { describe, expect, it } from 'vitest'
import { nextSort, sortRows } from './sortRows'

const col = (rows: unknown[][]) => rows.map((r) => r[0])

describe('sortRows', () => {
  it('returns rows unchanged when no sort is set', () => {
    const rows = [[2], [1]]
    expect(sortRows(rows, null, 'Int32')).toBe(rows)
  })

  it('does not mutate the input', () => {
    const rows = [[2], [1]]
    sortRows(rows, { col: 0, dir: 'asc' }, 'Int32')
    expect(col(rows)).toEqual([2, 1])
  })

  it('sorts integer strings numerically, not lexically', () => {
    const rows = [['10'], ['9'], ['100']]
    expect(col(sortRows(rows, { col: 0, dir: 'asc' }, 'Int64'))).toEqual(['9', '10', '100'])
  })

  it('keeps order for BigInts beyond 2^53', () => {
    const rows = [['9007199254740993'], ['9007199254740992']]
    expect(col(sortRows(rows, { col: 0, dir: 'asc' }, 'Int64'))).toEqual([
      '9007199254740992',
      '9007199254740993',
    ])
  })

  it('sorts decimal strings numerically including negatives', () => {
    const rows = [['12.50'], ['-3.25'], ['2.00']]
    expect(col(sortRows(rows, { col: 0, dir: 'desc' }, 'Decimal(10,2)'))).toEqual(['12.50', '2.00', '-3.25'])
  })

  it('sorts floats', () => {
    const rows = [[1.5], [-2], [0.25]]
    expect(col(sortRows(rows, { col: 0, dir: 'asc' }, 'Float64'))).toEqual([-2, 0.25, 1.5])
  })

  it('sorts strings', () => {
    const rows = [['b'], ['a'], ['c']]
    expect(col(sortRows(rows, { col: 0, dir: 'desc' }, 'Utf8'))).toEqual(['c', 'b', 'a'])
  })

  it('sorts timestamps stored as numbers', () => {
    const rows = [[300], [100], [200]]
    expect(col(sortRows(rows, { col: 0, dir: 'asc' }, 'Timestamp<MICROSECOND>'))).toEqual([100, 200, 300])
  })

  it('puts nulls last in both directions', () => {
    const rows = [[null], [2], [undefined], [1]]
    expect(col(sortRows(rows, { col: 0, dir: 'asc' }, 'Int32'))).toEqual([1, 2, null, undefined])
    expect(col(sortRows(rows, { col: 0, dir: 'desc' }, 'Int32'))).toEqual([2, 1, null, undefined])
  })

  it('is stable for equal keys', () => {
    const rows = [[1, 'a'], [1, 'b'], [0, 'c']]
    expect(sortRows(rows, { col: 0, dir: 'asc' }, 'Int32').map((r) => r[1])).toEqual(['c', 'a', 'b'])
    expect(sortRows(rows, { col: 0, dir: 'desc' }, 'Int32').map((r) => r[1])).toEqual(['a', 'b', 'c'])
  })

  it('sorts by the requested column', () => {
    const rows = [['x', 3], ['y', 1], ['z', 2]]
    expect(sortRows(rows, { col: 1, dir: 'asc' }, 'Int32').map((r) => r[0])).toEqual(['y', 'z', 'x'])
  })
})

describe('nextSort', () => {
  it('cycles asc → desc → off', () => {
    const asc = nextSort(null, 2)
    expect(asc).toEqual({ col: 2, dir: 'asc' })
    const desc = nextSort(asc, 2)
    expect(desc).toEqual({ col: 2, dir: 'desc' })
    expect(nextSort(desc, 2)).toBeNull()
  })

  it('starts ascending when switching columns', () => {
    expect(nextSort({ col: 0, dir: 'desc' }, 1)).toEqual({ col: 1, dir: 'asc' })
  })
})

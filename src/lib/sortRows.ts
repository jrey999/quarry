export type SortDir = 'asc' | 'desc'

export interface SortState {
  col: number
  dir: SortDir
}

// Arrow type names as produced by `field.type.toString()` in runQuery, plus our own Decimal(p,s).
const NUMERIC_TYPE = /^(u?int|float|double|decimal)/i
const INTEGER_STRING = /^-?\d+$/

export function isNumericType(type: string): boolean {
  return NUMERIC_TYPE.test(type)
}

function isNil(v: unknown): v is null | undefined {
  return v === null || v === undefined
}

function compareNumeric(a: unknown, b: unknown): number {
  // BigInt and Decimal values arrive as strings (see normalizeValue); compare exact integers
  // as BigInt so values beyond 2^53 keep their order.
  if (typeof a === 'string' && typeof b === 'string' && INTEGER_STRING.test(a) && INTEGER_STRING.test(b)) {
    const x = BigInt(a)
    const y = BigInt(b)
    return x < y ? -1 : x > y ? 1 : 0
  }
  const x = Number(a)
  const y = Number(b)
  if (Number.isNaN(x) || Number.isNaN(y)) {
    if (Number.isNaN(x) && Number.isNaN(y)) return 0
    return Number.isNaN(x) ? 1 : -1
  }
  return x - y
}

function compareGeneric(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/** Compare two cell values of a column of the given type. Nulls are not handled here. */
export function compareValues(a: unknown, b: unknown, type: string): number {
  return isNumericType(type) ? compareNumeric(a, b) : compareGeneric(a, b)
}

/** Returns a sorted copy; nulls always sort last regardless of direction. Stable. */
export function sortRows(rows: unknown[][], sort: SortState | null, type: string): unknown[][] {
  if (!sort) return rows
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows
    .map((row, i) => ({ row, i }))
    .sort((p, q) => {
      const a = p.row[sort.col]
      const b = q.row[sort.col]
      if (isNil(a) || isNil(b)) {
        if (isNil(a) && isNil(b)) return p.i - q.i
        return isNil(a) ? 1 : -1
      }
      return sign * compareValues(a, b, type) || p.i - q.i
    })
    .map((p) => p.row)
}

/** Click cycle for a header: asc → desc → unsorted. */
export function nextSort(current: SortState | null, col: number): SortState | null {
  if (!current || current.col !== col) return { col, dir: 'asc' }
  return current.dir === 'asc' ? { col, dir: 'desc' } : null
}

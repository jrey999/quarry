import * as duckdb from '@duckdb/duckdb-wasm'
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

export interface ColumnInfo {
  name: string
  type: string
}

export interface QueryResult {
  columns: ColumnInfo[]
  rows: unknown[][]
}

export interface FileStats {
  rowCount: number
  fileSizeBytes: number
}

export interface LoadedFile {
  tableName: string
  originalName: string
}

let dbInstance: duckdb.AsyncDuckDB | null = null
let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

async function getDB(): Promise<duckdb.AsyncDuckDB> {
  if (dbInstance) return dbInstance
  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
      mvp: {
        mainModule: duckdb_wasm,
        mainWorker: mvp_worker,
      },
      eh: {
        mainModule: duckdb_wasm_eh,
        mainWorker: eh_worker,
      },
    }

    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
    const worker = new Worker(bundle.mainWorker!)
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    dbInstance = db
    return db
  })()

  return dbPromise
}

export function sanitizeTableName(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '')
  const sanitized = withoutExt.replace(/[^a-zA-Z0-9_]/g, '_')
  return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized
}

export async function loadFile(file: File): Promise<LoadedFile> {
  const buffer = new Uint8Array(await file.arrayBuffer())
  return loadBuffer(file.name, buffer)
}

export async function loadBuffer(name: string, buffer: Uint8Array): Promise<LoadedFile> {
  const db = await getDB()
  const tableName = sanitizeTableName(name)

  const isParquet = /\.parquet$/i.test(name)
  const registeredName = name

  await db.registerFileBuffer(registeredName, buffer)

  const conn = await db.connect()
  try {
    if (isParquet) {
      await conn.query(
        `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM parquet_scan('${registeredName}')`,
      )
    } else {
      await conn.query(
        `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${registeredName}')`,
      )
    }
  } finally {
    await conn.close()
  }

  return { tableName, originalName: name }
}

export async function runQuery(sql: string): Promise<QueryResult> {
  const db = await getDB()
  const conn = await db.connect()
  try {
    const result = await conn.query(sql)
    const fields = result.schema.fields.map((f) => {
      const scale = (f.type as { scale?: number }).scale
      const precision = (f.type as { precision?: number }).precision
      const isDecimal = typeof scale === 'number' && typeof precision === 'number'
      return {
        name: f.name,
        type: isDecimal ? `Decimal(${precision},${scale})` : f.type.toString(),
        scale: isDecimal ? scale : undefined,
      }
    })
    const columns: ColumnInfo[] = fields.map((f) => ({ name: f.name, type: f.type }))
    const rows: unknown[][] = result.toArray().map((row) => {
      const obj = row.toJSON()
      return fields.map((f) => normalizeValue(obj[f.name], f.scale))
    })
    return { columns, rows }
  } finally {
    await conn.close()
  }
}

function decimalWordsToBigInt(words: ArrayLike<number>): bigint {
  let value = 0n
  for (let i = words.length - 1; i >= 0; i--) {
    value = (value << 32n) | BigInt(words[i] >>> 0)
  }
  const bitLength = BigInt(words.length * 32)
  const signBit = 1n << (bitLength - 1n)
  if (value & signBit) value -= 1n << bitLength
  return value
}

function normalizeValue(value: unknown, decimalScale?: number): unknown {
  if (decimalScale !== undefined && value !== null && value !== undefined) {
    const unscaled = ArrayBuffer.isView(value)
      ? decimalWordsToBigInt(value as unknown as ArrayLike<number>)
      : typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string'
        ? BigInt(value as bigint | number | string)
        : undefined
    if (unscaled !== undefined) {
      const divisor = 10n ** BigInt(decimalScale)
      const whole = unscaled / divisor
      const frac = (unscaled < 0n ? -unscaled : unscaled) % divisor
      return `${whole}.${frac.toString().padStart(decimalScale, '0')}`
    }
  }
  if (typeof value === 'bigint') return value.toString()
  return value
}

export async function getSchema(tableName: string): Promise<ColumnInfo[]> {
  const db = await getDB()
  const conn = await db.connect()
  try {
    const result = await conn.query(`DESCRIBE "${tableName}"`)
    return result.toArray().map((row) => {
      const obj = row.toJSON()
      return { name: String(obj.column_name), type: String(obj.column_type) }
    })
  } finally {
    await conn.close()
  }
}

export async function getFileStats(
  tableName: string,
  fileSizeBytes: number,
): Promise<FileStats> {
  const db = await getDB()
  const conn = await db.connect()
  try {
    const result = await conn.query(`SELECT COUNT(*) AS cnt FROM "${tableName}"`)
    const rowCount = Number(result.toArray()[0].toJSON().cnt)
    return { rowCount, fileSizeBytes }
  } finally {
    await conn.close()
  }
}

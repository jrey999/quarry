export interface RegisteredTable {
  id: string
  schemaName: string
  tableName: string
  connectionId: string
  key: string
  // The source file that added this table; absent for tables registered by hand.
  manifestId?: string
}

const STORAGE_KEY = 'quarry.registeredTables'

function readAll(): RegisteredTable[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as RegisteredTable[]
  } catch {
    return []
  }
}

function writeAll(tables: RegisteredTable[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tables))
}

export function listRegisteredTables(): RegisteredTable[] {
  return readAll()
}

export function registerTable(input: Omit<RegisteredTable, 'id'>): RegisteredTable {
  const tables = readAll()
  const table: RegisteredTable = { id: crypto.randomUUID(), ...input }
  tables.push(table)
  writeAll(tables)
  return table
}

export function updateRegisteredTable(id: string, input: Omit<RegisteredTable, 'id'>): void {
  const tables = readAll()
  const index = tables.findIndex((t) => t.id === id)
  if (index !== -1) {
    tables[index] = { ...tables[index], ...input, id }
    writeAll(tables)
  }
}

export function unregisterTable(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id))
}

export function unregisterTablesByManifest(manifestId: string): void {
  writeAll(readAll().filter((t) => t.manifestId !== manifestId))
}

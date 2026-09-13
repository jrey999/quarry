export interface SavedQuery {
  id: string
  name: string
  sql: string
  updatedAt: number
}

const STORAGE_KEY = 'quarry.savedQueries'

function readAll(): SavedQuery[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as SavedQuery[]
  } catch {
    return []
  }
}

function writeAll(queries: SavedQuery[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queries))
}

export function listSavedQueries(): SavedQuery[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveQuery(name: string, sql: string): SavedQuery {
  const queries = readAll()
  const query: SavedQuery = {
    id: crypto.randomUUID(),
    name,
    sql,
    updatedAt: Date.now(),
  }
  queries.push(query)
  writeAll(queries)
  return query
}

export function renameQuery(id: string, newName: string): void {
  const queries = readAll()
  const query = queries.find((q) => q.id === id)
  if (query) {
    query.name = newName
    query.updatedAt = Date.now()
    writeAll(queries)
  }
}

export function deleteQuery(id: string): void {
  writeAll(readAll().filter((q) => q.id !== id))
}

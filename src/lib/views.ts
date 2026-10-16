export interface SavedView {
  id: string
  schemaName: string
  viewName: string
  sql: string
  // The source file that added this view; absent for views saved by hand.
  manifestId?: string
}

const STORAGE_KEY = 'quarry.savedViews'

function readAll(): SavedView[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as SavedView[]
  } catch {
    return []
  }
}

function writeAll(views: SavedView[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views))
}

export function listSavedViews(): SavedView[] {
  return readAll()
}

export function createView(input: Omit<SavedView, 'id'>): SavedView {
  const views = readAll()
  const view: SavedView = { id: crypto.randomUUID(), ...input }
  views.push(view)
  writeAll(views)
  return view
}

export function updateView(id: string, input: Omit<SavedView, 'id'>): void {
  const views = readAll()
  const index = views.findIndex((v) => v.id === id)
  if (index !== -1) {
    views[index] = { ...views[index], ...input, id }
    writeAll(views)
  }
}

export function deleteView(id: string): void {
  writeAll(readAll().filter((v) => v.id !== id))
}

export function deleteViewsByManifest(manifestId: string): void {
  writeAll(readAll().filter((v) => v.manifestId !== manifestId))
}

// Where a view's definition gets mirrored in the writer bucket, when one is configured.
export function viewObjectKey(schemaName: string, viewName: string): string {
  return `_quarry/views/${schemaName}/${viewName}.sql`
}

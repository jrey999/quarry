export interface SourceManifest {
  id: string
  label: string
  kind: 'inline' | 'reference'
  // kind: 'inline' — no pre-existing file; the manifest text is stored here directly.
  content?: string
  // kind: 'reference' — points at a file that already lives in a bucket; refresh re-fetches it.
  connectionId?: string
  key?: string
}

const STORAGE_KEY = 'quarry.sourceManifests'

function readAll(): SourceManifest[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as SourceManifest[]
  } catch {
    return []
  }
}

function writeAll(manifests: SourceManifest[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(manifests))
}

export function listSourceManifests(): SourceManifest[] {
  return readAll()
}

export function addSourceManifest(input: Omit<SourceManifest, 'id'> & { id?: string }): SourceManifest {
  const manifests = readAll()
  const manifest: SourceManifest = { ...input, id: input.id ?? crypto.randomUUID() }
  manifests.push(manifest)
  writeAll(manifests)
  return manifest
}

export function updateSourceManifestContent(id: string, content: string): void {
  const manifests = readAll()
  const index = manifests.findIndex((m) => m.id === id)
  if (index !== -1) {
    manifests[index] = { ...manifests[index], content }
    writeAll(manifests)
  }
}

export function deleteSourceManifest(id: string): void {
  writeAll(readAll().filter((m) => m.id !== id))
}

export function sourceManifestObjectKey(label: string): string {
  return `_quarry/sources/${label}.yml`
}

const ACTIVE_KEY = 'quarry.activeSourceManifest'
const NO_ACTIVE = ''

// Only one source file is active at a time. Never having chosen (or having deleted the
// chosen one) falls back to the newest, so a fresh or upgraded install shows something.
// An explicit "none" is stored as an empty string and is respected.
export function getActiveSourceManifestId(manifests: SourceManifest[] = readAll()): string | null {
  const stored = localStorage.getItem(ACTIVE_KEY)
  if (stored === NO_ACTIVE) return null
  if (stored !== null && manifests.some((m) => m.id === stored)) return stored
  return manifests[manifests.length - 1]?.id ?? null
}

export function setActiveSourceManifestId(id: string | null): void {
  localStorage.setItem(ACTIVE_KEY, id ?? NO_ACTIVE)
}

// Entries added by hand have no owner and always show; an entry added by a source file
// only shows while that file is the active one.
export function isVisibleForActive(ownerId: string | undefined, activeId: string | null): boolean {
  return ownerId === undefined || ownerId === activeId
}

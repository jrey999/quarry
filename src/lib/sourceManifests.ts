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

export function addSourceManifest(input: Omit<SourceManifest, 'id'>): SourceManifest {
  const manifests = readAll()
  const manifest: SourceManifest = { id: crypto.randomUUID(), ...input }
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

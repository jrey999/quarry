export interface BucketConnection {
  id: string
  endpointHost: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  isWriter?: boolean
}

const STORAGE_KEY = 'quarry.bucketConnections'

function readAll(): BucketConnection[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as BucketConnection[]
  } catch {
    return []
  }
}

function writeAll(connections: BucketConnection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connections))
}

export function listBucketConnections(): BucketConnection[] {
  return readAll()
}

export function addBucketConnection(input: Omit<BucketConnection, 'id'>): BucketConnection {
  const connections = readAll()
  const connection: BucketConnection = { id: crypto.randomUUID(), ...input }
  connections.push(connection)
  writeAll(connections)
  return connection
}

export function updateBucketConnection(id: string, input: Omit<BucketConnection, 'id'>): void {
  const connections = readAll()
  const index = connections.findIndex((c) => c.id === id)
  if (index !== -1) {
    // isWriter is managed separately via setWriterBucket; preserve it unless the
    // caller explicitly included it, so an ordinary field edit can't silently clear it.
    connections[index] = { id, isWriter: connections[index].isWriter, ...input }
    writeAll(connections)
  }
}

export function deleteBucketConnection(id: string): void {
  writeAll(readAll().filter((c) => c.id !== id))
}

export function getWriterBucket(): BucketConnection | undefined {
  return readAll().find((c) => c.isWriter)
}

// Only one connection may be the writer bucket at a time; pass null to clear it.
export function setWriterBucket(id: string | null): void {
  writeAll(readAll().map((c) => ({ ...c, isWriter: c.id === id })))
}

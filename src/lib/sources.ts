export interface BucketConnection {
  id: string
  endpointHost: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
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
    connections[index] = { id, ...input }
    writeAll(connections)
  }
}

export function deleteBucketConnection(id: string): void {
  writeAll(readAll().filter((c) => c.id !== id))
}

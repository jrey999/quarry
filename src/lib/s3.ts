import type { BucketConnection } from './sources'

export interface S3Entry {
  key: string
  name: string
  isFolder: boolean
  size?: number
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return toHex(hash)
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

function canonicalUri(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/')
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(params[k])}`)
    .join('&')
}

function amzDateParts(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

// Presigned (query-string) SigV4: the signature lives in the URL, not in headers.
// That makes the actual request a CORS "simple request" with no custom headers, so
// browsers never send a preflight OPTIONS for it. This matters because some S3-compatible
// providers (DigitalOcean Spaces included) run OPTIONS preflights through the same
// anonymous-access check as any other unauthenticated request — a private bucket rejects
// the (necessarily credential-less) preflight with 403 before CORS is ever evaluated,
// regardless of how the bucket's CORS rules are configured. Presigning sidesteps that
// entirely since there is no preflight to reject.
async function presignedUrl(
  conn: BucketConnection,
  path: string,
  extraQuery: Record<string, string>,
  host: string,
  expiresSeconds = 300,
): Promise<string> {
  const { amzDate, dateStamp } = amzDateParts(new Date())
  const credentialScope = `${dateStamp}/${conn.region}/s3/aws4_request`

  const queryParams: Record<string, string> = {
    ...extraQuery,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${conn.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQueryStr = canonicalQuery(queryParams)
  const canonicalHeaders = `host:${host}\n`
  const canonicalRequest = ['GET', path, canonicalQueryStr, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest)
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hashedCanonicalRequest].join('\n')

  const kDate = await hmac(new TextEncoder().encode('AWS4' + conn.secretAccessKey), dateStamp)
  const kRegion = await hmac(kDate, conn.region)
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = toHex(await hmac(kSigning, stringToSign))

  return `https://${host}${path}?${canonicalQueryStr}&X-Amz-Signature=${signature}`
}

function basename(key: string, isFolder: boolean): string {
  const trimmed = isFolder ? key.replace(/\/$/, '') : key
  const parts = trimmed.split('/')
  return parts[parts.length - 1] || trimmed
}

async function fetchOrExplain(url: string): Promise<Response> {
  try {
    return await fetch(url)
  } catch {
    throw new Error(
      `Network error reaching the bucket. Check that the endpoint host and region are correct, and that the bucket allows access from ${window.location.origin} (its CORS rules should allow GET).`,
    )
  }
}

export async function listObjects(conn: BucketConnection, prefix: string): Promise<S3Entry[]> {
  const host = `${conn.bucket}.${conn.endpointHost}`
  const url = await presignedUrl(conn, '/', { 'list-type': '2', delimiter: '/', prefix }, host)

  const res = await fetchOrExplain(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`S3 list failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const xmlText = await res.text()
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) throw new Error('Failed to parse S3 response')

  const folders: S3Entry[] = Array.from(doc.getElementsByTagName('CommonPrefixes')).map((node) => {
    const p = node.getElementsByTagName('Prefix')[0]?.textContent ?? ''
    return { key: p, name: basename(p, true), isFolder: true }
  })

  const files: S3Entry[] = Array.from(doc.getElementsByTagName('Contents'))
    .map((node) => {
      const key = node.getElementsByTagName('Key')[0]?.textContent ?? ''
      const sizeText = node.getElementsByTagName('Size')[0]?.textContent
      return { key, name: basename(key, false), isFolder: false, size: sizeText ? Number(sizeText) : undefined }
    })
    .filter((f) => f.key !== prefix)

  return [...folders, ...files]
}

export async function fetchObject(conn: BucketConnection, key: string): Promise<Uint8Array> {
  const host = `${conn.bucket}.${conn.endpointHost}`
  const path = '/' + canonicalUri(key)
  const url = await presignedUrl(conn, path, {}, host)

  const res = await fetchOrExplain(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`S3 fetch failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

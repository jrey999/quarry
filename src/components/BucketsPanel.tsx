import { useState } from 'react'
import type { BucketConnection } from '../lib/sources'
import { listObjects, type S3Entry } from '../lib/s3'

interface TestStatus {
  state: 'idle' | 'testing' | 'success' | 'error'
  message?: string
  entries?: S3Entry[]
  snapshot?: string
}

const idleTest: TestStatus = { state: 'idle' }

interface NodeState {
  entries: S3Entry[] | null
  loading: boolean
  error: string | null
  expanded: boolean
}

interface RegionOption {
  value: string
  label: string
}

const DO_REGIONS: RegionOption[] = [
  { value: 'nyc3', label: 'NYC3' },
  { value: 'ams3', label: 'AMS3' },
  { value: 'sgp1', label: 'SGP1' },
  { value: 'sfo3', label: 'SFO3' },
  { value: 'fra1', label: 'FRA1' },
  { value: 'syd1', label: 'SYD1' },
]

const AWS_REGIONS: RegionOption[] = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU (Ireland)' },
  { value: 'eu-central-1', label: 'EU (Frankfurt)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
]

type ProviderKey = 'digitalocean' | 'aws' | 'other'

const PROVIDERS: Record<
  ProviderKey,
  { label: string; regions: RegionOption[] | null; hostFor: (region: string) => string }
> = {
  digitalocean: {
    label: 'DigitalOcean Spaces',
    regions: DO_REGIONS,
    hostFor: (region) => `${region}.digitaloceanspaces.com`,
  },
  aws: {
    label: 'Amazon S3',
    regions: AWS_REGIONS,
    hostFor: (region) => (region === 'us-east-1' ? 's3.amazonaws.com' : `s3.${region}.amazonaws.com`),
  },
  other: {
    label: 'Other…',
    regions: null,
    hostFor: () => '',
  },
}

const emptyForm = {
  provider: 'digitalocean' as ProviderKey,
  region: DO_REGIONS[0].value,
  customHost: '',
  customRegion: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  isWriter: false,
}

function detectProviderForEdit(conn: BucketConnection): typeof emptyForm {
  for (const key of ['digitalocean', 'aws'] as ProviderKey[]) {
    const provider = PROVIDERS[key]
    const match = provider.regions?.find((r) => provider.hostFor(r.value) === conn.endpointHost)
    if (match) {
      return {
        provider: key,
        region: match.value,
        customHost: '',
        customRegion: '',
        bucket: conn.bucket,
        accessKeyId: conn.accessKeyId,
        secretAccessKey: conn.secretAccessKey,
        isWriter: conn.isWriter ?? false,
      }
    }
  }
  return {
    provider: 'other',
    region: DO_REGIONS[0].value,
    customHost: conn.endpointHost,
    customRegion: conn.region,
    bucket: conn.bucket,
    accessKeyId: conn.accessKeyId,
    secretAccessKey: conn.secretAccessKey,
    isWriter: conn.isWriter ?? false,
  }
}

function nodeKey(connectionId: string, prefix: string): string {
  return `${connectionId}::${prefix}`
}

export interface RegisterControls {
  key: string | null
  schema: string
  table: string
  start: (conn: BucketConnection, entry: S3Entry) => void
  setSchema: (v: string) => void
  setTable: (v: string) => void
  commit: (conn: BucketConnection, entry: S3Entry) => void
  cancel: () => void
}

interface Props {
  connections: BucketConnection[]
  onAdd: (input: Omit<BucketConnection, 'id'>) => BucketConnection
  onUpdate: (id: string, input: Omit<BucketConnection, 'id'>) => void
  onDelete: (id: string) => void
  onOpenFile: (conn: BucketConnection, entry: S3Entry) => void
  onRegister: (conn: BucketConnection, entry: S3Entry, schemaName: string, tableName: string) => void
  onSetWriter: (id: string | null) => void
  loadingKey: string | null
}

function sanitizeIdentifier(name: string): string {
  const withoutExt = name.replace(/\.[^/.]+$/, '')
  return withoutExt.replace(/[^a-zA-Z0-9_]/g, '_')
}

export function BucketsPanel({
  connections,
  onAdd,
  onUpdate,
  onDelete,
  onOpenFile,
  onRegister,
  onSetWriter,
  loadingKey,
}: Props) {
  const [nodeStates, setNodeStates] = useState<Map<string, NodeState>>(new Map())
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [testStatus, setTestStatus] = useState<TestStatus>(idleTest)
  const [registeringKey, setRegisteringKey] = useState<string | null>(null)
  const [regSchema, setRegSchema] = useState('')
  const [regTable, setRegTable] = useState('')

  const registerControls: RegisterControls = {
    key: registeringKey,
    schema: regSchema,
    table: regTable,
    setSchema: setRegSchema,
    setTable: setRegTable,
    start: (conn, entry) => {
      setRegisteringKey(`${conn.id}::${entry.key}`)
      setRegSchema('')
      setRegTable(sanitizeIdentifier(entry.name))
    },
    commit: (conn, entry) => {
      const schemaName = regSchema.trim()
      const tableName = regTable.trim()
      if (schemaName && tableName) {
        onRegister(conn, entry, schemaName, tableName)
      }
      setRegisteringKey(null)
    },
    cancel: () => setRegisteringKey(null),
  }

  function getState(connectionId: string, prefix: string): NodeState {
    return (
      nodeStates.get(nodeKey(connectionId, prefix)) ?? {
        entries: null,
        loading: false,
        error: null,
        expanded: false,
      }
    )
  }

  function setState(connectionId: string, prefix: string, patch: Partial<NodeState>) {
    setNodeStates((prev) => {
      const next = new Map(prev)
      const key = nodeKey(connectionId, prefix)
      const current = prev.get(key) ?? { entries: null, loading: false, error: null, expanded: false }
      next.set(key, { ...current, ...patch })
      return next
    })
  }

  async function toggle(conn: BucketConnection, prefix: string) {
    const state = getState(conn.id, prefix)
    if (!state.expanded && state.entries === null && !state.loading) {
      setState(conn.id, prefix, { loading: true, error: null, expanded: true })
      try {
        const entries = await listObjects(conn, prefix)
        setState(conn.id, prefix, { entries, loading: false })
      } catch (err) {
        setState(conn.id, prefix, { loading: false, error: err instanceof Error ? err.message : String(err) })
      }
    } else {
      setState(conn.id, prefix, { expanded: !state.expanded })
    }
  }

  function toggleDomain(domain: string) {
    setCollapsedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  function openAddForm() {
    setEditingId(null)
    setForm(emptyForm)
    setTestStatus(idleTest)
    setShowForm(true)
  }

  function openEditForm(conn: BucketConnection) {
    setEditingId(conn.id)
    setForm(detectProviderForEdit(conn))
    setTestStatus(idleTest)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
    setTestStatus(idleTest)
  }

  function resolveInput(): Omit<BucketConnection, 'id'> | null {
    const isOther = form.provider === 'other'
    const endpointHost = (isOther ? form.customHost : PROVIDERS[form.provider].hostFor(form.region)).trim()
    const region = (isOther ? form.customRegion : form.region).trim()
    if (!endpointHost || !region || !form.bucket.trim() || !form.accessKeyId.trim() || !form.secretAccessKey.trim()) {
      return null
    }
    return {
      endpointHost: endpointHost.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      bucket: form.bucket.trim(),
      region,
      accessKeyId: form.accessKeyId.trim(),
      secretAccessKey: form.secretAccessKey.trim(),
    }
  }

  async function handleTest() {
    const input = resolveInput()
    if (!input) {
      setTestStatus({ state: 'error', message: 'Fill in all fields first.' })
      return
    }
    setTestStatus({ state: 'testing' })
    try {
      const entries = await listObjects({ id: '__test__', ...input }, '')
      setTestStatus({ state: 'success', message: `Connected — ${entries.length} item(s) at root`, entries, snapshot: JSON.stringify(input) })
    } catch (err) {
      setTestStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  function handleSubmit() {
    const input = resolveInput()
    if (!input) return

    const cachedEntries = testStatus.state === 'success' && testStatus.snapshot === JSON.stringify(input) ? testStatus.entries : undefined

    if (editingId) {
      onUpdate(editingId, input)
      const wasWriter = connections.find((c) => c.id === editingId)?.isWriter ?? false
      if (form.isWriter && !wasWriter) onSetWriter(editingId)
      else if (!form.isWriter && wasWriter) onSetWriter(null)
      if (cachedEntries) {
        setState(editingId, '', { entries: cachedEntries, loading: false, expanded: true })
      }
    } else {
      const created = onAdd(input)
      if (form.isWriter) onSetWriter(created.id)
      if (cachedEntries) {
        setState(created.id, '', { entries: cachedEntries, loading: false, expanded: true })
      }
    }
    closeForm()
  }

  const domains = new Map<string, BucketConnection[]>()
  for (const conn of connections) {
    const list = domains.get(conn.endpointHost) ?? []
    list.push(conn)
    domains.set(conn.endpointHost, list)
  }

  return (
    <div className="buckets-panel">
      <button className="add-bucket-toggle" onClick={() => (showForm ? closeForm() : openAddForm())}>
        {showForm ? 'Cancel' : '+ Add bucket'}
      </button>

      {showForm && (
        <div className="add-bucket-form">
          <select
            value={form.provider}
            onChange={(e) => {
              const provider = e.target.value as ProviderKey
              setForm((f) => ({ ...f, provider, region: PROVIDERS[provider].regions?.[0]?.value ?? '' }))
            }}
          >
            {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => (
              <option key={key} value={key}>
                {PROVIDERS[key].label}
              </option>
            ))}
          </select>
          {form.provider === 'other' ? (
            <>
              <input
                type="text"
                placeholder="Endpoint host (e.g. minio.example.com)"
                value={form.customHost}
                onChange={(e) => setForm((f) => ({ ...f, customHost: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Region (e.g. us-east-1)"
                value={form.customRegion}
                onChange={(e) => setForm((f) => ({ ...f, customRegion: e.target.value }))}
              />
            </>
          ) : (
            <select value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}>
              {PROVIDERS[form.provider].regions!.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            placeholder="Bucket name"
            value={form.bucket}
            onChange={(e) => setForm((f) => ({ ...f, bucket: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Access Key ID"
            value={form.accessKeyId}
            onChange={(e) => setForm((f) => ({ ...f, accessKeyId: e.target.value }))}
          />
          <input
            type="password"
            placeholder="Secret Access Key"
            value={form.secretAccessKey}
            onChange={(e) => setForm((f) => ({ ...f, secretAccessKey: e.target.value }))}
          />
          <label className="writer-checkbox">
            <input
              type="checkbox"
              checked={form.isWriter}
              onChange={(e) => setForm((f) => ({ ...f, isWriter: e.target.checked }))}
            />
            Use as metadata store (_quarry/)
          </label>
          <div className="bucket-form-actions">
            <button onClick={handleTest} disabled={testStatus.state === 'testing'}>
              {testStatus.state === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            <button onClick={handleSubmit}>{editingId ? 'Save changes' : 'Save connection'}</button>
          </div>
          {testStatus.state === 'success' && <p className="test-status test-status-success">✓ {testStatus.message}</p>}
          {testStatus.state === 'error' && <p className="test-status test-status-error">✗ {testStatus.message}</p>}
        </div>
      )}

      {domains.size === 0 && !showForm && <p className="muted">No buckets added yet.</p>}

      {Array.from(domains.entries()).map(([domain, conns]) => {
        const collapsed = collapsedDomains.has(domain)
        return (
          <div key={domain} className="bucket-domain-group">
            <div className="bucket-domain-header" onClick={() => toggleDomain(domain)}>
              <span className="disclosure">{collapsed ? '▸' : '▾'}</span>
              {domain}
            </div>
            {!collapsed && (
              <div className="bucket-domain-body">
                {conns.map((conn) => (
                  <BucketNode
                    key={conn.id}
                    conn={conn}
                    prefix=""
                    depth={0}
                    getState={getState}
                    toggle={toggle}
                    onEdit={openEditForm}
                    onDelete={onDelete}
                    onOpenFile={onOpenFile}
                    loadingKey={loadingKey}
                    registerControls={registerControls}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface BucketNodeProps {
  conn: BucketConnection
  prefix: string
  depth: number
  getState: (connectionId: string, prefix: string) => NodeState
  toggle: (conn: BucketConnection, prefix: string) => void
  onEdit: (conn: BucketConnection) => void
  onDelete: (id: string) => void
  onOpenFile: (conn: BucketConnection, entry: S3Entry) => void
  loadingKey: string | null
  registerControls: RegisterControls
}

function BucketNode({
  conn,
  prefix,
  depth,
  getState,
  toggle,
  onEdit,
  onDelete,
  onOpenFile,
  loadingKey,
  registerControls,
}: BucketNodeProps) {
  const state = getState(conn.id, prefix)
  const isRoot = prefix === ''

  return (
    <div className="bucket-node" style={{ paddingLeft: depth * 14 }}>
      <div className="bucket-node-row">
        <span className="disclosure" onClick={() => toggle(conn, prefix)}>
          {state.loading ? '…' : state.expanded ? '▾' : '▸'}
        </span>
        <span className="bucket-node-name" onClick={() => toggle(conn, prefix)}>
          {isRoot ? `📦 ${conn.bucket}` : basenameOf(prefix)}
          {isRoot && conn.isWriter && (
            <span className="writer-badge" title="Metadata store (_quarry/)">
              ★
            </span>
          )}
        </span>
        {isRoot && (
          <>
            <button className="bucket-edit" onClick={() => onEdit(conn)}>
              Edit
            </button>
            <button className="bucket-delete" onClick={() => onDelete(conn.id)}>
              ×
            </button>
          </>
        )}
      </div>
      {state.error && <p className="error bucket-error">{state.error}</p>}
      {state.expanded && state.entries && (
        <div>
          {state.entries.map((entry) => {
            if (entry.isFolder) {
              return (
                <BucketNode
                  key={entry.key}
                  conn={conn}
                  prefix={entry.key}
                  depth={depth + 1}
                  getState={getState}
                  toggle={toggle}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onOpenFile={onOpenFile}
                  loadingKey={loadingKey}
                  registerControls={registerControls}
                />
              )
            }
            const fileKey = `${conn.id}::${entry.key}`
            const isRegistering = registerControls.key === fileKey
            return (
              <div key={entry.key} style={{ paddingLeft: (depth + 1) * 14 }}>
                {isRegistering ? (
                  <div className="registry-inline-form">
                    <input
                      type="text"
                      placeholder="schema"
                      value={registerControls.schema}
                      autoFocus
                      onChange={(e) => registerControls.setSchema(e.target.value)}
                    />
                    <span>.</span>
                    <input
                      type="text"
                      placeholder="table"
                      value={registerControls.table}
                      onChange={(e) => registerControls.setTable(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') registerControls.commit(conn, entry)
                        if (e.key === 'Escape') registerControls.cancel()
                      }}
                    />
                    <button onClick={() => registerControls.commit(conn, entry)}>Save</button>
                    <button onClick={registerControls.cancel}>Cancel</button>
                  </div>
                ) : (
                  <div
                    className="bucket-file-row"
                    onDoubleClick={() => onOpenFile(conn, entry)}
                    title="Double-click to load into DuckDB"
                  >
                    <span className="bucket-file-name">
                      {loadingKey === fileKey ? '…' : '📄'} {entry.name}
                    </span>
                    <button
                      className="bucket-register"
                      onClick={(e) => {
                        e.stopPropagation()
                        registerControls.start(conn, entry)
                      }}
                    >
                      + schema
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {state.entries.length === 0 && (
            <p className="muted bucket-empty" style={{ paddingLeft: (depth + 1) * 14 }}>
              Empty
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function basenameOf(prefix: string): string {
  const trimmed = prefix.replace(/\/$/, '')
  const parts = trimmed.split('/')
  return parts[parts.length - 1] || trimmed
}

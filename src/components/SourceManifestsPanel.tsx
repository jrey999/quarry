import { useState } from 'react'
import type { SourceManifest } from '../lib/sourceManifests'
import type { BucketConnection } from '../lib/sources'
import type { ManifestApplyOutcome } from '../lib/manifestApply'
import { generateSourceYml } from '../lib/manifestGenerate'
import { listAllDataKeys } from '../lib/s3'

type AddMode = 'paste' | 'reference' | 'generate'

interface Props {
  manifests: SourceManifest[]
  activeId: string | null
  onSetActive: (id: string | null) => void
  connections: BucketConnection[]
  onAddInline: (label: string, content: string) => Promise<ManifestApplyOutcome>
  onAddReference: (label: string, connectionId: string, key: string) => Promise<ManifestApplyOutcome>
  onRefresh: (manifest: SourceManifest) => Promise<ManifestApplyOutcome>
  onDelete: (id: string) => void
}

function describeOutcome(outcome: ManifestApplyOutcome): string {
  const parts: string[] = []
  if (outcome.tablesCreated) parts.push(`${outcome.tablesCreated} table(s) added`)
  if (outcome.tablesUpdated) parts.push(`${outcome.tablesUpdated} table(s) updated`)
  if (outcome.viewsCreated) parts.push(`${outcome.viewsCreated} view(s) added`)
  if (outcome.viewsUpdated) parts.push(`${outcome.viewsUpdated} view(s) updated`)
  return parts.length > 0 ? parts.join(', ') : 'Nothing to apply'
}

export function SourceManifestsPanel({
  manifests,
  activeId,
  onSetActive,
  connections,
  onAddInline,
  onAddReference,
  onRefresh,
  onDelete,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [mode, setMode] = useState<AddMode>('paste')
  const [label, setLabel] = useState('')
  const [content, setContent] = useState('')
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '')
  const [key, setKey] = useState('')
  const [prefix, setPrefix] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [statusById, setStatusById] = useState<Map<string, { ok: boolean; message: string }>>(new Map())

  function setStatus(id: string, ok: boolean, message: string) {
    setStatusById((prev) => new Map(prev).set(id, { ok, message }))
  }

  function resetForm() {
    setShowForm(false)
    setFormError(null)
    setLabel('')
    setContent('')
    setKey('')
    setPrefix('')
  }

  // Drops the generated YAML into the paste editor so it can be reviewed and edited
  // before the normal "Save & apply" button registers it.
  async function handleGenerate() {
    const conn = connections.find((c) => c.id === connectionId)
    if (!conn) {
      setFormError('Pick a bucket to generate from.')
      return
    }

    setBusyId('__generate__')
    setFormError(null)
    try {
      const keys = await listAllDataKeys(conn, prefix.trim())
      if (keys.length === 0) {
        setFormError('No .csv or .parquet files found under that prefix.')
        return
      }
      setContent(generateSourceYml({ keys, sourceName: conn.bucket, endpoint: conn.endpointHost, bucket: conn.bucket }))
      if (!label.trim()) setLabel(conn.bucket)
      setMode('paste')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function handleSubmit() {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return

    setBusyId('__new__')
    setFormError(null)
    try {
      const outcome =
        mode === 'paste'
          ? await onAddInline(trimmedLabel, content)
          : await onAddReference(trimmedLabel, connectionId, key.trim())
      setStatus(
        trimmedLabel,
        outcome.errors.length === 0,
        outcome.errors.length > 0 ? `${describeOutcome(outcome)} — ${outcome.errors.join(' ')}` : describeOutcome(outcome),
      )
      resetForm()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function handleRefreshClick(manifest: SourceManifest) {
    setBusyId(manifest.id)
    try {
      const outcome = await onRefresh(manifest)
      setStatus(
        manifest.id,
        outcome.errors.length === 0,
        outcome.errors.length > 0 ? `${describeOutcome(outcome)} — ${outcome.errors.join(' ')}` : describeOutcome(outcome),
      )
    } catch (err) {
      setStatus(manifest.id, false, err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="manifests-panel">
      <button className="create-view-toggle" onClick={() => (showForm ? resetForm() : setShowForm(true))}>
        {showForm ? 'Cancel' : '+ Add source file'}
      </button>

      {showForm && (
        <div className="manifest-form">
          <input type="text" placeholder="Label (e.g. main)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="manifest-mode-toggle">
            <label>
              <input type="radio" checked={mode === 'paste'} onChange={() => setMode('paste')} />
              Paste YAML
            </label>
            <label>
              <input type="radio" checked={mode === 'reference'} onChange={() => setMode('reference')} />
              Reference bucket file
            </label>
            <label>
              <input type="radio" checked={mode === 'generate'} onChange={() => setMode('generate')} />
              Generate from bucket
            </label>
          </div>
          {mode === 'paste' ? (
            <textarea
              className="manifest-textarea"
              placeholder="sources:&#10;  - name: main&#10;    endpoint: ...&#10;    bucket: ..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          ) : (
            <>
              <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                {connections.length === 0 && <option value="">No buckets added yet</option>}
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.bucket} ({c.endpointHost})
                  </option>
                ))}
              </select>
              {mode === 'reference' ? (
                <input type="text" placeholder="Key (e.g. sources.yml)" value={key} onChange={(e) => setKey(e.target.value)} />
              ) : (
                <input
                  type="text"
                  placeholder="Prefix (optional, e.g. warehouse/)"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              )}
            </>
          )}
          {mode === 'generate' ? (
            <button onClick={handleGenerate} disabled={busyId === '__generate__'}>
              {busyId === '__generate__' ? 'Scanning bucket…' : 'Generate YAML'}
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={busyId === '__new__'}>
              {busyId === '__new__' ? 'Applying…' : 'Save & apply'}
            </button>
          )}
          {formError && <p className="test-status test-status-error">{formError}</p>}
        </div>
      )}

      {manifests.length === 0 && !showForm && <p className="muted">No source files added yet.</p>}

      {manifests.map((m) => {
        const status = statusById.get(m.id) ?? statusById.get(m.label)
        return (
          <div key={m.id} className="manifest-row">
            <label className="manifest-label">
              <input
                type="checkbox"
                checked={m.id === activeId}
                onChange={() => onSetActive(m.id === activeId ? null : m.id)}
                title="Only the active source file's tables and views are shown"
              />
              📄 {m.label} <span className="manifest-kind">({m.kind})</span>
            </label>
            <span className="manifest-actions">
              {m.kind === 'reference' && (
                <button onClick={() => handleRefreshClick(m)} disabled={busyId === m.id}>
                  {busyId === m.id ? '…' : 'Refresh'}
                </button>
              )}
              <button onClick={() => onDelete(m.id)}>Delete</button>
            </span>
            {status && <p className={status.ok ? 'test-status test-status-success' : 'test-status test-status-error'}>{status.message}</p>}
          </div>
        )
      })}
    </div>
  )
}

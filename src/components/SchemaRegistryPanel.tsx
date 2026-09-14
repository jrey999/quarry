import { useState } from 'react'
import type { RegisteredTable } from '../lib/registry'
import type { SavedView } from '../lib/views'
import type { BucketConnection } from '../lib/sources'

type Entry =
  | { kind: 'table'; id: string; schemaName: string; name: string; data: RegisteredTable }
  | { kind: 'view'; id: string; schemaName: string; name: string; data: SavedView }

interface Props {
  tables: RegisteredTable[]
  views: SavedView[]
  connections: BucketConnection[]
  onUpdateTable: (id: string, input: Omit<RegisteredTable, 'id'>) => void
  onDeleteTable: (id: string) => void
  onOpenTable: (table: RegisteredTable) => void
  onCreateView: (schemaName: string, viewName: string) => void
  onUpdateView: (id: string, schemaName: string, viewName: string, sql: string) => void
  onDeleteView: (id: string) => void
  onOpenView: (view: SavedView) => void
  loadingId: string | null
}

export function SchemaRegistryPanel({
  tables,
  views,
  connections,
  onUpdateTable,
  onDeleteTable,
  onOpenTable,
  onCreateView,
  onUpdateView,
  onDeleteView,
  onOpenView,
  loadingId,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSchema, setEditSchema] = useState('')
  const [editName, setEditName] = useState('')
  const [showCreateView, setShowCreateView] = useState(false)
  const [newViewSchema, setNewViewSchema] = useState('')
  const [newViewName, setNewViewName] = useState('')

  const entries: Entry[] = [
    ...tables.map((t): Entry => ({ kind: 'table', id: t.id, schemaName: t.schemaName, name: t.tableName, data: t })),
    ...views.map((v): Entry => ({ kind: 'view', id: v.id, schemaName: v.schemaName, name: v.viewName, data: v })),
  ]

  const bySchema = new Map<string, Entry[]>()
  for (const entry of entries) {
    const list = bySchema.get(entry.schemaName) ?? []
    list.push(entry)
    bySchema.set(entry.schemaName, list)
  }
  const connectionsById = new Map(connections.map((c) => [c.id, c]))

  function startEdit(entry: Entry) {
    setEditingId(entry.id)
    setEditSchema(entry.schemaName)
    setEditName(entry.name)
  }

  function commitEdit(entry: Entry) {
    const schemaName = editSchema.trim()
    const name = editName.trim()
    if (schemaName && name) {
      if (entry.kind === 'table') {
        onUpdateTable(entry.id, { schemaName, tableName: name, connectionId: entry.data.connectionId, key: entry.data.key })
      } else {
        onUpdateView(entry.id, schemaName, name, entry.data.sql)
      }
    }
    setEditingId(null)
  }

  function submitCreateView() {
    const schemaName = newViewSchema.trim()
    const viewName = newViewName.trim()
    if (schemaName && viewName) {
      onCreateView(schemaName, viewName)
      setShowCreateView(false)
      setNewViewSchema('')
      setNewViewName('')
    }
  }

  return (
    <div className="registry-panel">
      <button className="create-view-toggle" onClick={() => setShowCreateView((v) => !v)}>
        {showCreateView ? 'Cancel' : '+ Create view'}
      </button>

      {showCreateView && (
        <div className="registry-edit-form">
          <input
            type="text"
            value={newViewSchema}
            onChange={(e) => setNewViewSchema(e.target.value)}
            placeholder="schema"
          />
          <input
            type="text"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            placeholder="view name"
            onKeyDown={(e) => e.key === 'Enter' && submitCreateView()}
          />
          <button onClick={submitCreateView}>Save</button>
        </div>
      )}
      {showCreateView && <p className="muted">Saves the current query editor contents as the view's definition.</p>}

      {entries.length === 0 && !showCreateView && (
        <p className="muted">No tables or views yet. Register a bucket file, or create a view.</p>
      )}

      {Array.from(bySchema.entries()).map(([schemaName, schemaEntries]) => (
        <div key={schemaName} className="registry-schema-group">
          <div className="registry-schema-name">{schemaName}</div>
          {schemaEntries.map((entry) => {
            const isEditing = editingId === entry.id
            const conn = entry.kind === 'table' ? connectionsById.get(entry.data.connectionId) : undefined
            const title =
              entry.kind === 'table'
                ? conn
                  ? `${conn.bucket}/${entry.data.key}`
                  : entry.data.key
                : entry.data.sql
            return (
              <div key={entry.id} className="registry-table-row">
                {isEditing ? (
                  <div className="registry-edit-form">
                    <input
                      type="text"
                      value={editSchema}
                      onChange={(e) => setEditSchema(e.target.value)}
                      placeholder="schema"
                    />
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="name"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(entry)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <button onClick={() => commitEdit(entry)}>Save</button>
                  </div>
                ) : (
                  <>
                    <span
                      className="registry-table-name"
                      onClick={() => (entry.kind === 'table' ? onOpenTable(entry.data) : onOpenView(entry.data))}
                      title={title}
                    >
                      {loadingId === entry.id ? '…' : entry.kind === 'table' ? '🗂' : '👁'} {entry.name}
                    </span>
                    <span className="registry-actions">
                      <button onClick={() => startEdit(entry)}>Edit</button>
                      <button onClick={() => (entry.kind === 'table' ? onDeleteTable(entry.id) : onDeleteView(entry.id))}>
                        Delete
                      </button>
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

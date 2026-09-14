import { useState } from 'react'
import type { RegisteredTable } from '../lib/registry'
import type { BucketConnection } from '../lib/sources'

interface Props {
  tables: RegisteredTable[]
  connections: BucketConnection[]
  onUpdate: (id: string, input: Omit<RegisteredTable, 'id'>) => void
  onDelete: (id: string) => void
  onOpenTable: (table: RegisteredTable) => void
  loadingId: string | null
}

export function SchemaRegistryPanel({ tables, connections, onUpdate, onDelete, onOpenTable, loadingId }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSchema, setEditSchema] = useState('')
  const [editTable, setEditTable] = useState('')

  if (tables.length === 0) {
    return <p className="muted">No tables registered yet. Add one from a bucket file.</p>
  }

  const bySchema = new Map<string, RegisteredTable[]>()
  for (const table of tables) {
    const list = bySchema.get(table.schemaName) ?? []
    list.push(table)
    bySchema.set(table.schemaName, list)
  }

  function startEdit(table: RegisteredTable) {
    setEditingId(table.id)
    setEditSchema(table.schemaName)
    setEditTable(table.tableName)
  }

  function commitEdit(table: RegisteredTable) {
    const schemaName = editSchema.trim()
    const tableName = editTable.trim()
    if (schemaName && tableName) {
      onUpdate(table.id, { schemaName, tableName, connectionId: table.connectionId, key: table.key })
    }
    setEditingId(null)
  }

  return (
    <div className="registry-panel">
      {Array.from(bySchema.entries()).map(([schemaName, entries]) => {
        const connectionsById = new Map(connections.map((c) => [c.id, c]))
        return (
          <div key={schemaName} className="registry-schema-group">
            <div className="registry-schema-name">{schemaName}</div>
            {entries.map((table) => {
              const conn = connectionsById.get(table.connectionId)
              const isEditing = editingId === table.id
              return (
                <div key={table.id} className="registry-table-row">
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
                        value={editTable}
                        onChange={(e) => setEditTable(e.target.value)}
                        placeholder="table"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(table)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <button onClick={() => commitEdit(table)}>Save</button>
                    </div>
                  ) : (
                    <>
                      <span
                        className="registry-table-name"
                        onClick={() => onOpenTable(table)}
                        title={conn ? `${conn.bucket}/${table.key}` : table.key}
                      >
                        {loadingId === table.id ? '…' : '🗂'} {table.tableName}
                      </span>
                      <span className="registry-actions">
                        <button onClick={() => startEdit(table)}>Edit</button>
                        <button onClick={() => onDelete(table.id)}>Delete</button>
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

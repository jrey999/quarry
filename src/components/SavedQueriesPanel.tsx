import { useState } from 'react'
import type { SavedQuery } from '../lib/savedQueries'

interface Props {
  queries: SavedQuery[]
  onLoad: (query: SavedQuery) => void
  onSave: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function SavedQueriesPanel({ queries, onLoad, onSave, onRename, onDelete }: Props) {
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  function handleSave() {
    const name = newName.trim()
    if (!name) return
    onSave(name)
    setNewName('')
  }

  return (
    <div className="saved-queries">
      <div className="save-form">
        <input
          type="text"
          placeholder="Query name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        />
        <button onClick={handleSave}>Save current query</button>
      </div>
      {queries.length === 0 ? (
        <p className="muted">No saved queries yet.</p>
      ) : (
        <ul className="saved-list">
          {queries.map((q) => (
            <li key={q.id}>
              {renamingId === q.id ? (
                <input
                  type="text"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onRename(q.id, renameValue.trim() || q.name)
                      setRenamingId(null)
                    } else if (e.key === 'Escape') {
                      setRenamingId(null)
                    }
                  }}
                  onBlur={() => setRenamingId(null)}
                />
              ) : (
                <span className="saved-name" onClick={() => onLoad(q)}>
                  {q.name}
                </span>
              )}
              <span className="saved-actions">
                <button
                  onClick={() => {
                    setRenamingId(q.id)
                    setRenameValue(q.name)
                  }}
                >
                  Rename
                </button>
                <button onClick={() => onDelete(q.id)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useState } from 'react'
import { FileDropZone } from './components/FileDropZone'
import { SchemaPanel, type TableInfo } from './components/SchemaPanel'
import { ResultsGrid } from './components/ResultsGrid'
import { SavedQueriesPanel } from './components/SavedQueriesPanel'
import { loadFile, runQuery, getSchema, getFileStats, type QueryResult } from './lib/duckdb'
import {
  listSavedQueries,
  saveQuery,
  renameQuery,
  deleteQuery,
  type SavedQuery,
} from './lib/savedQueries'

function App() {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => listSavedQueries())

  async function handleFiles(files: File[]) {
    setLoadingFiles(true)
    setError(null)
    try {
      for (const file of files) {
        const { tableName, originalName } = await loadFile(file)
        const columns = await getSchema(tableName)
        const stats = await getFileStats(tableName, file.size)
        setTables((prev) => [
          ...prev.filter((t) => t.tableName !== tableName),
          { tableName, originalName, columns, stats },
        ])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingFiles(false)
    }
  }

  async function handleRun(queryOverride?: string) {
    const queryToRun = queryOverride ?? sql
    if (!queryToRun.trim()) return
    setRunning(true)
    setError(null)
    try {
      const res = await runQuery(queryToRun)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  function handleSelectTable(tableName: string) {
    const query = `SELECT * FROM "${tableName}"`
    setSql(query)
    handleRun(query)
  }

  function handleSaveQuery(name: string) {
    saveQuery(name, sql)
    setSavedQueries(listSavedQueries())
  }

  function handleLoadQuery(query: SavedQuery) {
    setSql(query.sql)
  }

  function handleRenameQuery(id: string, name: string) {
    renameQuery(id, name)
    setSavedQueries(listSavedQueries())
  }

  function handleDeleteQuery(id: string) {
    deleteQuery(id)
    setSavedQueries(listSavedQueries())
  }

  return (
    <div className="app">
      <header>
        <h1>Quarry</h1>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <section>
            <h2>Files</h2>
            <FileDropZone onFiles={handleFiles} loading={loadingFiles} />
          </section>
          <section>
            <h2>Schema</h2>
            <SchemaPanel tables={tables} onSelectTable={handleSelectTable} />
          </section>
          <section>
            <h2>Saved queries</h2>
            <SavedQueriesPanel
              queries={savedQueries}
              onLoad={handleLoadQuery}
              onSave={handleSaveQuery}
              onRename={handleRenameQuery}
              onDelete={handleDeleteQuery}
            />
          </section>
        </aside>

        <main className="main">
          <section className="editor-section">
            <h2>Query</h2>
            <textarea
              className="sql-editor"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="SELECT * FROM my_table LIMIT 100"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleRun()
                }
              }}
            />
            <div className="editor-actions">
              <button onClick={() => handleRun()} disabled={running}>
                {running ? 'Running...' : 'Run query (Enter · Shift+Enter for newline)'}
              </button>
              {error && <span className="error">{error}</span>}
            </div>
          </section>

          <section className="results-section">
            <h2>Results</h2>
            <ResultsGrid result={result} />
          </section>
        </main>
      </div>
    </div>
  )
}

export default App

import { useState } from 'react'
import { FileDropZone } from './components/FileDropZone'
import { FilesPanel, type LoadedFileEntry } from './components/FilesPanel'
import { ResultsGrid } from './components/ResultsGrid'
import { SavedQueriesPanel } from './components/SavedQueriesPanel'
import { BucketsPanel } from './components/BucketsPanel'
import { SchemaRegistryPanel } from './components/SchemaRegistryPanel'
import { loadFile, loadBuffer, loadBufferAsSchemaTable, runQuery, type QueryResult } from './lib/duckdb'
import {
  listSavedQueries,
  saveQuery,
  renameQuery,
  deleteQuery,
  type SavedQuery,
} from './lib/savedQueries'
import {
  listBucketConnections,
  addBucketConnection,
  updateBucketConnection,
  deleteBucketConnection,
  setWriterBucket,
  type BucketConnection,
} from './lib/sources'
import {
  listRegisteredTables,
  registerTable,
  updateRegisteredTable,
  unregisterTable,
  type RegisteredTable,
} from './lib/registry'
import { fetchObject, type S3Entry } from './lib/s3'

interface CurrentFile {
  label: string
  source: 'local' | 'bucket' | 'registry'
}

function App() {
  const [files, setFiles] = useState<LoadedFileEntry[]>([])
  const [currentFile, setCurrentFile] = useState<CurrentFile | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => listSavedQueries())
  const [bucketConnections, setBucketConnections] = useState<BucketConnection[]>(() =>
    listBucketConnections(),
  )
  const [loadingBucketFile, setLoadingBucketFile] = useState<string | null>(null)
  const [registeredTables, setRegisteredTables] = useState<RegisteredTable[]>(() => listRegisteredTables())
  const [loadingRegisteredId, setLoadingRegisteredId] = useState<string | null>(null)
  const [loadedQualifiedNames, setLoadedQualifiedNames] = useState<Set<string>>(new Set())

  async function handleFiles(newFiles: File[]) {
    setLoadingFiles(true)
    setError(null)
    try {
      for (const file of newFiles) {
        const { tableName, originalName } = await loadFile(file)
        setFiles((prev) => [...prev.filter((f) => f.tableName !== tableName), { tableName, originalName }])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingFiles(false)
    }
  }

  async function loadRegisteredTable(table: RegisteredTable): Promise<void> {
    const qualifiedName = `${table.schemaName}.${table.tableName}`
    if (loadedQualifiedNames.has(qualifiedName)) return
    const conn = bucketConnections.find((c) => c.id === table.connectionId)
    if (!conn) throw new Error(`Bucket connection for "${qualifiedName}" no longer exists.`)
    const bytes = await fetchObject(conn, table.key)
    await loadBufferAsSchemaTable(table.schemaName, table.tableName, table.key, bytes)
    setLoadedQualifiedNames((prev) => new Set(prev).add(qualifiedName))
  }

  // Lets a raw query reference "schema"."table" (or schema.table) for any registered
  // table without having to click it in the Schema panel first — the underlying file
  // is fetched and loaded on demand, the same way clicking it would.
  async function ensureRegisteredTablesLoaded(query: string): Promise<void> {
    if (registeredTables.length === 0) return
    const pattern =
      /"([A-Za-z_][A-Za-z0-9_]*)"\s*\.\s*"([A-Za-z_][A-Za-z0-9_]*)"|\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g
    const refs = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = pattern.exec(query)) !== null) {
      const schemaName = m[1] ?? m[3]
      const tableName = m[2] ?? m[4]
      refs.add(`${schemaName}.${tableName}`)
    }
    for (const table of registeredTables) {
      if (refs.has(`${table.schemaName}.${table.tableName}`)) {
        await loadRegisteredTable(table)
      }
    }
  }

  async function handleRun(queryOverride?: string, keepCurrentFile = false) {
    const queryToRun = queryOverride ?? sql
    if (!queryToRun.trim()) return
    if (!keepCurrentFile) setCurrentFile(null)
    setRunning(true)
    setError(null)
    try {
      await ensureRegisteredTablesLoaded(queryToRun)
      const res = await runQuery(queryToRun)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  function handleSelectTable(tableName: string, label: string, source: CurrentFile['source']) {
    const query = `SELECT * FROM "${tableName}"`
    setSql(query)
    setCurrentFile({ label, source })
    handleRun(query, true)
  }

  function handleSaveQuery(name: string) {
    saveQuery(name, sql)
    setSavedQueries(listSavedQueries())
  }

  function handleLoadQuery(query: SavedQuery) {
    setSql(query.sql)
    setCurrentFile(null)
  }

  function handleRenameQuery(id: string, name: string) {
    renameQuery(id, name)
    setSavedQueries(listSavedQueries())
  }

  function handleDeleteQuery(id: string) {
    deleteQuery(id)
    setSavedQueries(listSavedQueries())
  }

  function handleAddBucket(input: Omit<BucketConnection, 'id'>): BucketConnection {
    const created = addBucketConnection(input)
    setBucketConnections(listBucketConnections())
    return created
  }

  function handleUpdateBucket(id: string, input: Omit<BucketConnection, 'id'>) {
    updateBucketConnection(id, input)
    setBucketConnections(listBucketConnections())
  }

  function handleDeleteBucket(id: string) {
    deleteBucketConnection(id)
    setBucketConnections(listBucketConnections())
  }

  function handleSetWriterBucket(id: string | null) {
    setWriterBucket(id)
    setBucketConnections(listBucketConnections())
  }

  async function handleOpenBucketFile(conn: BucketConnection, entry: S3Entry) {
    const key = `${conn.id}::${entry.key}`
    setLoadingBucketFile(key)
    setError(null)
    try {
      const bytes = await fetchObject(conn, entry.key)
      const { tableName } = await loadBuffer(entry.name, bytes)
      handleSelectTable(tableName, entry.name, 'bucket')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingBucketFile(null)
    }
  }

  function handleRegisterFile(conn: BucketConnection, entry: S3Entry, schemaName: string, tableName: string) {
    registerTable({ schemaName, tableName, connectionId: conn.id, key: entry.key })
    setRegisteredTables(listRegisteredTables())
  }

  function handleUpdateRegisteredTable(id: string, input: Omit<RegisteredTable, 'id'>) {
    updateRegisteredTable(id, input)
    setRegisteredTables(listRegisteredTables())
  }

  function handleDeleteRegisteredTable(id: string) {
    unregisterTable(id)
    setRegisteredTables(listRegisteredTables())
  }

  async function handleOpenRegisteredTable(table: RegisteredTable) {
    setLoadingRegisteredId(table.id)
    setError(null)
    try {
      await loadRegisteredTable(table)
      const query = `SELECT * FROM "${table.schemaName}"."${table.tableName}"`
      setSql(query)
      setCurrentFile({ label: `${table.schemaName}.${table.tableName}`, source: 'registry' })
      await handleRun(query, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingRegisteredId(null)
    }
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
            <FilesPanel
              files={files}
              onOpenFile={(file) => handleSelectTable(file.tableName, file.originalName, 'local')}
            />
          </section>
          <section>
            <h2>Buckets</h2>
            <BucketsPanel
              connections={bucketConnections}
              onAdd={handleAddBucket}
              onUpdate={handleUpdateBucket}
              onDelete={handleDeleteBucket}
              onOpenFile={handleOpenBucketFile}
              onRegister={handleRegisterFile}
              onSetWriter={handleSetWriterBucket}
              loadingKey={loadingBucketFile}
            />
          </section>
          <section>
            <h2>Schema</h2>
            <SchemaRegistryPanel
              tables={registeredTables}
              connections={bucketConnections}
              onUpdate={handleUpdateRegisteredTable}
              onDelete={handleDeleteRegisteredTable}
              onOpenTable={handleOpenRegisteredTable}
              loadingId={loadingRegisteredId}
            />
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
          <section className="now-viewing-section">
            <h2>Now viewing</h2>
            {currentFile ? (
              <p className="now-viewing">
                {currentFile.source === 'bucket' ? '📦' : currentFile.source === 'registry' ? '🗂' : '📄'}{' '}
                {currentFile.label}
              </p>
            ) : (
              <p className="muted">No file selected.</p>
            )}
          </section>

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

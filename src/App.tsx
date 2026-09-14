import { useMemo, useState } from 'react'
import type { SQLNamespace } from '@codemirror/lang-sql'
import { FileDropZone } from './components/FileDropZone'
import { FilesPanel, type LoadedFileEntry } from './components/FilesPanel'
import { ResultsGrid } from './components/ResultsGrid'
import { SavedQueriesPanel } from './components/SavedQueriesPanel'
import { BucketsPanel } from './components/BucketsPanel'
import { SchemaRegistryPanel } from './components/SchemaRegistryPanel'
import { SqlEditor } from './components/SqlEditor'
import {
  loadFile,
  loadBuffer,
  loadBufferAsSchemaTable,
  createOrReplaceView,
  runQuery,
  type QueryResult,
} from './lib/duckdb'
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
  getWriterBucket,
  type BucketConnection,
} from './lib/sources'
import {
  listRegisteredTables,
  registerTable,
  updateRegisteredTable,
  unregisterTable,
  type RegisteredTable,
} from './lib/registry'
import { listSavedViews, createView, updateView, deleteView, viewObjectKey, type SavedView } from './lib/views'
import { fetchObject, putObject, type S3Entry } from './lib/s3'

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
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => listSavedViews())

  const sqlSchema: SQLNamespace = useMemo(() => {
    const flatTables: Record<string, string[]> = {}
    for (const f of files) flatTables[f.tableName] = []

    const schemas: Record<string, Record<string, string[]>> = {}
    for (const t of registeredTables) {
      schemas[t.schemaName] = schemas[t.schemaName] ?? {}
      schemas[t.schemaName][t.tableName] = []
    }
    for (const v of savedViews) {
      schemas[v.schemaName] = schemas[v.schemaName] ?? {}
      schemas[v.schemaName][v.viewName] = []
    }

    return { ...flatTables, ...schemas }
  }, [files, registeredTables, savedViews])

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

  function extractQualifiedRefs(query: string): string[] {
    const pattern =
      /"([A-Za-z_][A-Za-z0-9_]*)"\s*\.\s*"([A-Za-z_][A-Za-z0-9_]*)"|\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g
    const refs = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = pattern.exec(query)) !== null) {
      refs.add(`${m[1] ?? m[3]}.${m[2] ?? m[4]}`)
    }
    return [...refs]
  }

  // Lets a raw query reference "schema"."table" or "schema"."view" without having to
  // click it in the Schema panel first — the underlying file (or, for a view, whatever
  // it in turn references) is loaded on demand, recursively, the same way clicking it would.
  async function ensureQualifiedRefsLoaded(query: string, processing: Set<string> = new Set()): Promise<void> {
    if (registeredTables.length === 0 && savedViews.length === 0) return
    for (const ref of extractQualifiedRefs(query)) {
      if (loadedQualifiedNames.has(ref) || processing.has(ref)) continue
      processing.add(ref)

      const table = registeredTables.find((t) => `${t.schemaName}.${t.tableName}` === ref)
      if (table) {
        await loadRegisteredTable(table)
        continue
      }

      const view = savedViews.find((v) => `${v.schemaName}.${v.viewName}` === ref)
      if (view) {
        await ensureQualifiedRefsLoaded(view.sql, processing)
        await createOrReplaceView(view.schemaName, view.viewName, view.sql)
        setLoadedQualifiedNames((prev) => new Set(prev).add(ref))
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
      await ensureQualifiedRefsLoaded(queryToRun)
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

  async function syncViewToWriterBucket(schemaName: string, viewName: string, viewSql: string) {
    const writer = getWriterBucket()
    if (!writer) return
    try {
      await putObject(writer, viewObjectKey(schemaName, viewName), new TextEncoder().encode(viewSql))
    } catch (err) {
      setError(
        `View saved locally, but syncing to ${writer.bucket} failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async function handleCreateView(schemaName: string, viewName: string) {
    setError(null)
    try {
      const viewSql = sql
      await ensureQualifiedRefsLoaded(viewSql)
      await createOrReplaceView(schemaName, viewName, viewSql)
      createView({ schemaName, viewName, sql: viewSql })
      setSavedViews(listSavedViews())
      setLoadedQualifiedNames((prev) => new Set(prev).add(`${schemaName}.${viewName}`))
      const previewQuery = `SELECT * FROM "${schemaName}"."${viewName}"`
      setSql(previewQuery)
      setCurrentFile({ label: `${schemaName}.${viewName}`, source: 'registry' })
      await handleRun(previewQuery, true)
      await syncViewToWriterBucket(schemaName, viewName, viewSql)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleUpdateView(id: string, schemaName: string, viewName: string, viewSql: string) {
    setError(null)
    try {
      await ensureQualifiedRefsLoaded(viewSql)
      await createOrReplaceView(schemaName, viewName, viewSql)
      updateView(id, { schemaName, viewName, sql: viewSql })
      setSavedViews(listSavedViews())
      setLoadedQualifiedNames((prev) => new Set(prev).add(`${schemaName}.${viewName}`))
      await syncViewToWriterBucket(schemaName, viewName, viewSql)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleDeleteView(id: string) {
    deleteView(id)
    setSavedViews(listSavedViews())
  }

  async function handleOpenView(view: SavedView) {
    setError(null)
    try {
      const query = `SELECT * FROM "${view.schemaName}"."${view.viewName}"`
      setSql(query)
      setCurrentFile({ label: `${view.schemaName}.${view.viewName}`, source: 'registry' })
      await handleRun(query, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
              views={savedViews}
              connections={bucketConnections}
              onUpdateTable={handleUpdateRegisteredTable}
              onDeleteTable={handleDeleteRegisteredTable}
              onOpenTable={handleOpenRegisteredTable}
              onCreateView={handleCreateView}
              onUpdateView={handleUpdateView}
              onDeleteView={handleDeleteView}
              onOpenView={handleOpenView}
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
            <SqlEditor value={sql} onChange={setSql} onRun={() => handleRun()} schema={sqlSchema} />
            <div className="editor-actions">
              <button onClick={() => handleRun()} disabled={running}>
                {running ? 'Running...' : 'Run query (Cmd/Ctrl+Enter or Shift+Enter · Enter for newline)'}
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

import type { ColumnInfo, FileStats } from '../lib/duckdb'

export interface TableInfo {
  tableName: string
  originalName: string
  columns: ColumnInfo[]
  stats: FileStats
}

interface Props {
  tables: TableInfo[]
  onSelectTable: (tableName: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

export function SchemaPanel({ tables, onSelectTable }: Props) {
  if (tables.length === 0) {
    return <p className="muted">No files loaded yet.</p>
  }

  return (
    <div className="schema-panel">
      {tables.map((table) => (
        <div key={table.tableName} className="schema-table">
          <h3 className="schema-table-name" onClick={() => onSelectTable(table.tableName)}>
            {table.tableName}
          </h3>
          <p className="muted">
            {table.originalName} · {table.stats.rowCount.toLocaleString()} rows ·{' '}
            {formatBytes(table.stats.fileSizeBytes)}
          </p>
          <table>
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col) => (
                <tr key={col.name}>
                  <td>{col.name}</td>
                  <td>{col.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

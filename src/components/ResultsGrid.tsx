import { useState } from 'react'
import type { QueryResult } from '../lib/duckdb'

interface Props {
  result: QueryResult | null
}

const PAGE_SIZE = 100

export function ResultsGrid({ result }: Props) {
  const [page, setPage] = useState(0)

  if (!result) {
    return <p className="muted">Run a query to see results.</p>
  }

  const { columns, rows } = result
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const start = currentPage * PAGE_SIZE
  const pageRows = rows.slice(start, start + PAGE_SIZE)

  return (
    <div className="results-grid">
      <div className="results-toolbar">
        <span className="muted">
          {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
        </span>
        <div className="pager">
          <button
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Prev
          </button>
          <span>
            Page {currentPage + 1} / {pageCount}
          </span>
          <button
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      </div>
      <div className="results-table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.name}>
                  {col.name}
                  <span className="col-type">{col.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={start + i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell === null || cell === undefined ? '' : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

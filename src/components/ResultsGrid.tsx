import { useState } from 'react'
import type { QueryResult } from '../lib/duckdb'
import { nextSort, sortRows, type SortState } from '../lib/sortRows'

interface Props {
  result: QueryResult | null
}

const PAGE_SIZE = 100

export function ResultsGrid({ result }: Props) {
  const [page, setPage] = useState(0)
  // Tied to the result it was set for, so a new query starts unsorted.
  const [sortFor, setSortFor] = useState<{ result: QueryResult | null; sort: SortState | null }>({
    result: null,
    sort: null,
  })

  if (!result) {
    return <p className="muted">Run a query to see results.</p>
  }

  const { columns } = result
  const sort = sortFor.result === result ? sortFor.sort : null
  const rows = sort ? sortRows(result.rows, sort, columns[sort.col].type) : result.rows
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
              {columns.map((col, j) => {
                const dir = sort?.col === j ? sort.dir : null
                return (
                  <th
                    key={col.name}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                  >
                    <button
                      className="sort-button"
                      title={`Sort by ${col.name}`}
                      onClick={() => {
                        setSortFor({ result, sort: nextSort(sort, j) })
                        setPage(0)
                      }}
                    >
                      {col.name}
                      <span className="sort-indicator">{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}</span>
                    </button>
                    <span className="col-type">{col.type}</span>
                  </th>
                )
              })}
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

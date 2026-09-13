# Quarry

Local-first parquet/CSV viewer and SQL query tool, built on DuckDB-WASM.

## Usage

```bash
npm install
npm run dev
```

Drag `.parquet` or `.csv` files onto the drop zone (or click to pick files).
Each file is loaded as a DuckDB table named after its filename. Write SQL
against one or more loaded tables in the query editor and run it with the
button or Cmd/Ctrl+Enter. Save queries by name in the sidebar; they persist
in the browser across reloads.

## Structure

- `src/lib/duckdb.ts` — DuckDB-WASM setup, file loading, query execution, schema/stats.
- `src/lib/savedQueries.ts` — saved-query persistence (localStorage-backed).
- `src/components/` — UI components (drop zone, schema panel, results grid, saved queries).

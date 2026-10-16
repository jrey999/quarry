import { beforeEach, describe, expect, it } from 'vitest'
import { listRegisteredTables, registerTable, unregisterTables } from './registry'
import { createView, deleteViews, listSavedViews } from './views'

beforeEach(() => {
  localStorage.clear()
})

describe('bulk delete', () => {
  it('removes only the named tables', () => {
    const a = registerTable({ schemaName: 's', tableName: 'a', connectionId: 'c', key: 'a.parquet' })
    const b = registerTable({ schemaName: 's', tableName: 'b', connectionId: 'c', key: 'b.parquet' })
    const keep = registerTable({ schemaName: 't', tableName: 'keep', connectionId: 'c', key: 'k.parquet' })

    unregisterTables([a.id, b.id])

    expect(listRegisteredTables()).toEqual([keep])
  })

  it('removes only the named views', () => {
    const a = createView({ schemaName: 's', viewName: 'a', sql: 'select 1' })
    const keep = createView({ schemaName: 't', viewName: 'keep', sql: 'select 2' })

    deleteViews([a.id])

    expect(listSavedViews()).toEqual([keep])
  })

  it('does nothing for an empty list', () => {
    const t = registerTable({ schemaName: 's', tableName: 'a', connectionId: 'c', key: 'a.parquet' })
    unregisterTables([])
    expect(listRegisteredTables()).toEqual([t])
  })
})

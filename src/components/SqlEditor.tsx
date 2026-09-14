import CodeMirror from '@uiw/react-codemirror'
import { sql, PostgreSQL, type SQLNamespace } from '@codemirror/lang-sql'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'

interface Props {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  schema: SQLNamespace
}

export function SqlEditor({ value, onChange, onRun, schema }: Props) {
  const runKeymap = Prec.highest(
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onRun()
          return true
        },
      },
      {
        key: 'Shift-Enter',
        run: () => {
          onRun()
          return true
        },
      },
    ]),
  )

  return (
    <CodeMirror
      className="sql-editor"
      value={value}
      height="140px"
      placeholder="SELECT * FROM my_table LIMIT 100"
      extensions={[sql({ dialect: PostgreSQL, schema, upperCaseKeywords: true }), runKeymap]}
      onChange={onChange}
    />
  )
}

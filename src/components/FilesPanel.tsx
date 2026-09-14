export interface LoadedFileEntry {
  tableName: string
  originalName: string
}

interface Props {
  files: LoadedFileEntry[]
  onOpenFile: (file: LoadedFileEntry) => void
}

export function FilesPanel({ files, onOpenFile }: Props) {
  if (files.length === 0) {
    return <p className="muted">No files loaded yet.</p>
  }

  return (
    <div className="files-panel">
      {files.map((file) => (
        <div
          key={file.tableName}
          className="loaded-file-row"
          onDoubleClick={() => onOpenFile(file)}
          title="Double-click to preview"
        >
          📄 {file.originalName}
        </div>
      ))}
    </div>
  )
}

import { useCallback, useRef, useState } from "react"
import { Upload, FolderOpen, FileText, X, AlertCircle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { readUploadedFile } from "@/utils/logParser"
import type { UploadedFile } from "@/types/logs"

interface FileUploadProps {
  onFilesLoaded: (files: UploadedFile[]) => void
}

interface FileStatus {
  name: string
  status: "pending" | "parsing" | "done" | "error"
  error?: string
  isSubagent?: boolean
  agentId?: string
}

export function FileUpload({ onFilesLoaded }: FileUploadProps) {
  const [dragging, setDragging] = useState(false)
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([])
  const [processing, setProcessing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const processFiles = useCallback(async (fileList: File[]) => {
    // Accept .jsonl and .json files
    const valid = fileList.filter((f) => f.name.endsWith(".jsonl") || f.name.endsWith(".json"))
    if (valid.length === 0) return

    setProcessing(true)
    const statuses: FileStatus[] = valid.map((f) => ({ name: f.name, status: "pending" as const }))
    setFileStatuses(statuses)

    const results: UploadedFile[] = []

    for (let i = 0; i < valid.length; i++) {
      setFileStatuses((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "parsing" } : s))
      )
      try {
        const parsed = await readUploadedFile(valid[i])
        results.push(parsed)
        setFileStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "done", isSubagent: parsed.isSubagent, agentId: parsed.agentId }
              : s
          )
        )
      } catch (err) {
        setFileStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: "error", error: String(err) } : s
          )
        )
      }
    }

    setProcessing(false)
    if (results.length > 0) onFilesLoaded(results)
  }, [onFilesLoaded])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const files = Array.from(e.dataTransfer.files)
      processFiles(files)
    },
    [processFiles]
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      processFiles(files)
      e.target.value = ""
    },
    [processFiles]
  )

  const clearFiles = () => {
    setFileStatuses([])
  }

  const doneCount = fileStatuses.filter((f) => f.status === "done").length
  const errorCount = fileStatuses.filter((f) => f.status === "error").length

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto">
      {/* Drop zone */}
      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border",
          "p-12 transition-all cursor-pointer select-none",
          dragging && "drag-over",
          "hover:border-primary/50 hover:bg-primary/5"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Upload className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-foreground">
            Drop Claude session log files here
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload <span className="font-mono text-foreground">.jsonl</span> files — main sessions, subagents, and meta files
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Select Files
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click() }}
          >
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            Select Folder
          </Button>
        </div>

        {/* Hidden inputs */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".jsonl,.json"
          className="hidden"
          onChange={onInputChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error – webkitdirectory is non-standard
          webkitdirectory=""
          className="hidden"
          onChange={onInputChange}
        />
      </div>

      {/* Path hint */}
      <p className="text-xs text-muted-foreground text-center">
        Default log location: <span className="font-mono text-foreground/70">%USERPROFILE%\.claude\projects\&lt;project-name&gt;\</span>
      </p>

      {/* File list */}
      {fileStatuses.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>{fileStatuses.length} file{fileStatuses.length !== 1 ? "s" : ""}</span>
              {doneCount > 0 && (
                <Badge variant="success">{doneCount} parsed</Badge>
              )}
              {errorCount > 0 && (
                <Badge variant="destructive">{errorCount} failed</Badge>
              )}
              {processing && (
                <Badge variant="warning">Processing…</Badge>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={clearFiles}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ul className="max-h-48 overflow-y-auto divide-y divide-border">
            {fileStatuses.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-4 py-2">
                {f.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />}
                {f.status === "error" && <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />}
                {f.status === "parsing" && (
                  <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                )}
                {f.status === "pending" && (
                  <div className="h-4 w-4 rounded-full border-2 border-border shrink-0" />
                )}
                <span className="text-xs font-mono text-foreground truncate flex-1">{f.name}</span>
                {f.isSubagent && (
                  <Badge variant="warning" className="shrink-0">subagent</Badge>
                )}
                {f.error && (
                  <span className="text-xs text-red-400 shrink-0">{f.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

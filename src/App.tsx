import { useState, useCallback, useRef } from "react"
import { FileUpload } from "@/components/upload/FileUpload"
import { SessionDashboard } from "@/components/dashboard/SessionDashboard"
import { analyzeFiles } from "@/utils/logParser"
import type { UploadedFile, ProjectAnalysis } from "@/types/logs"
import { LayoutDashboard, Upload, RotateCcw, AlertTriangle, CheckCircle2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

type AddMoreStatus = {
  files: { name: string; status: "pending" | "parsing" | "done" | "error"; error?: string }[]
  analyzing: boolean
}

export default function App() {
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null)
  const [loadedFiles, setLoadedFiles] = useState<UploadedFile[]>([])
  const [addMore, setAddMore] = useState<AddMoreStatus | null>(null)
  const addMoreRef = useRef<HTMLInputElement>(null)

  const handleFilesLoaded = useCallback((files: UploadedFile[]) => {
    // Merge with previously loaded files (deduplicate by name)
    setLoadedFiles((prev) => {
      const existing = new Map(prev.map((f) => [f.name, f]))
      for (const f of files) existing.set(f.name, f)
      const merged = Array.from(existing.values())
      const result = analyzeFiles(merged)
      setAnalysis(result)
      return merged
    })
  }, [])

  const handleReset = () => {
    setAnalysis(null)
    setLoadedFiles([])
  }

  const hasOnlySubagents = loadedFiles.length > 0 &&
    loadedFiles.every((f) => f.isSubagent || f.name.endsWith(".meta.json"))

  const fileInput = (
    <input
      ref={addMoreRef}
      type="file"
      multiple
      accept=".jsonl,.json"
      className="hidden"
      onChange={async (e) => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = ""
        if (files.length === 0) return

        const { readUploadedFile } = await import("@/utils/logParser")
        setAddMore({
          files: files.map((f) => ({ name: f.name, status: "pending" })),
          analyzing: false,
        })

        const parsed: UploadedFile[] = []
        for (let i = 0; i < files.length; i++) {
          setAddMore((s) =>
            s ? { ...s, files: s.files.map((f, idx) => (idx === i ? { ...f, status: "parsing" } : f)) } : s,
          )
          try {
            const p = await readUploadedFile(files[i])
            parsed.push(p)
            setAddMore((s) =>
              s ? { ...s, files: s.files.map((f, idx) => (idx === i ? { ...f, status: "done" } : f)) } : s,
            )
          } catch (err) {
            setAddMore((s) =>
              s ? { ...s, files: s.files.map((f, idx) => (idx === i ? { ...f, status: "error", error: String(err) } : f)) } : s,
            )
          }
        }

        // Yield to the browser so the "Analyzing…" state actually paints before
        // analyzeFiles blocks the main thread on a multi-MB JSONL.
        setAddMore((s) => (s ? { ...s, analyzing: true } : s))
        await new Promise((r) => setTimeout(r, 30))
        if (parsed.length > 0) handleFilesLoaded(parsed)

        setAddMore((s) => (s ? { ...s, analyzing: false } : s))
        setTimeout(() => setAddMore(null), 1200)
      }}
    />
  )

  if (analysis) {
    return (
      <div className="relative h-screen">
        <SessionDashboard analysis={analysis} />

        {/* ── Subagent-only warning banner ─────────────────────────────── */}
        {hasOnlySubagents && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4">
            <div
              className="relative overflow-hidden rounded-xl border border-amber-500/40 bg-amber-950/80 backdrop-blur-sm px-4 py-3 shadow-lg shadow-amber-900/30"
              style={{ animation: "subtlePulse 3s ease-in-out infinite" }}
            >
              {/* flowing gradient shimmer */}
              <div
                className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, #f59e0b 40%, #fbbf24 50%, #f59e0b 60%, transparent 100%)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer 2.5s linear infinite",
                }}
              />
              <div className="relative flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-300">Only subagent logs loaded</p>
                  <p className="text-xs text-amber-400/80 mt-0.5">
                    Upload the main session <span className="font-mono">{"<uuid>.jsonl"}</span> to see the full conversation, timeline, and accurate token totals.
                  </p>
                </div>
                <button
                  onClick={() => addMoreRef.current?.click()}
                  className="shrink-0 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors"
                >
                  Upload Main Log
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Top-right controls ───────────────────────────────────────── */}
        <div className="fixed top-3 right-4 flex gap-2 z-50">
          <label className="cursor-pointer">
            {fileInput}
            <Button variant="outline" size="sm" className="pointer-events-none select-none">
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Add More Files
            </Button>
          </label>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset
          </Button>
        </div>

        {/* ── Add-more upload progress ─────────────────────────────────── */}
        {addMore && <AddMoreProgress status={addMore} onClose={() => setAddMore(null)} />}
      </div>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center p-8 gap-10">
      {/* Hero */}
      <header className="flex flex-col items-center gap-3 text-center mt-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 border border-primary/20">
          <LayoutDashboard className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
          Claude Session Analyser
        </h1>
        <p className="mt-1 text-sm md:text-base text-muted-foreground max-w-xl">
          A free, browser-based viewer for Claude Code session logs. Drop in your{" "}
          <span className="font-mono text-foreground">.jsonl</span> files to explore conversations,
          tool calls, subagents, and token usage — all processed locally, with nothing uploaded.
        </p>
      </header>

      {/* Upload area */}
      <section aria-label="Upload Claude Code session logs" className="w-full">
        <FileUpload onFilesLoaded={handleFilesLoaded} />
      </section>

      {/* Features */}
      <section aria-labelledby="features-heading" className="w-full max-w-2xl">
        <h2 id="features-heading" className="sr-only">Features</h2>
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="flex items-start gap-3 rounded-lg border border-border p-3 bg-card"
            >
              <div className={`rounded-lg p-1.5 ${f.color} shrink-0`}>
                <f.icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-foreground">{f.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="w-full max-w-2xl">
        <h2 id="how-heading" className="text-base font-semibold text-foreground mb-3 text-center">
          How it works
        </h2>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
          <li className="rounded-lg border border-border bg-card p-3">
            <span className="block text-foreground font-semibold mb-1">1. Find your logs</span>
            Claude Code stores sessions under{" "}
            <span className="font-mono text-foreground/70">~/.claude/projects/</span>.
          </li>
          <li className="rounded-lg border border-border bg-card p-3">
            <span className="block text-foreground font-semibold mb-1">2. Drop them in</span>
            Select individual <span className="font-mono">.jsonl</span> files or a whole project folder.
          </li>
          <li className="rounded-lg border border-border bg-card p-3">
            <span className="block text-foreground font-semibold mb-1">3. Explore</span>
            Inspect tool calls, subagents, tokens, cache reads, and the timeline.
          </li>
        </ol>
      </section>

      {/* Footer hint */}
      <footer className="text-xs text-muted-foreground text-center max-w-xl">
        <p>
          Logs are processed entirely in your browser — nothing is uploaded to any server,
          and no analytics or trackers run on this page.
        </p>
      </footer>
    </main>
  )
}

function AddMoreProgress({
  status,
  onClose,
}: {
  status: AddMoreStatus
  onClose: () => void
}) {
  const total = status.files.length
  const done = status.files.filter((f) => f.status === "done").length
  const errs = status.files.filter((f) => f.status === "error").length
  const parsing = status.files.find((f) => f.status === "parsing")
  const allDone = done + errs === total
  const finished = allDone && !status.analyzing

  return (
    <div className="fixed top-16 right-4 z-50 w-[380px] max-w-[95vw] rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium">
          {finished ? (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          ) : (
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          )}
          <span>
            {status.analyzing
              ? "Analyzing session…"
              : finished
                ? `Loaded ${done} of ${total}${errs ? ` · ${errs} failed` : ""}`
                : `Parsing ${done + (parsing ? 1 : 0)} / ${total}`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close progress panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="max-h-60 overflow-y-auto divide-y divide-border">
        {status.files.map((f) => (
          <li key={f.name} className="flex items-center gap-3 px-4 py-2">
            {f.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />}
            {f.status === "error" && <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
            {f.status === "parsing" && (
              <div className="h-3.5 w-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
            )}
            {f.status === "pending" && (
              <div className="h-3.5 w-3.5 rounded-full border-2 border-border shrink-0" />
            )}
            <span className="text-xs font-mono text-foreground truncate flex-1" title={f.name}>
              {f.name}
            </span>
            {f.error && <span className="text-xs text-red-400 shrink-0 truncate max-w-[140px]" title={f.error}>{f.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

import { MessageSquare, Wrench, Bot, BarChart2, Clock, Zap } from "lucide-react"

const FEATURES = [
  { icon: MessageSquare, title: "Conversation View", desc: "Browse full chat threads with thinking blocks", color: "bg-blue-500/10 text-blue-400" },
  { icon: Wrench, title: "Tool Call Analysis", desc: "Frequency charts and per-call input/output", color: "bg-green-500/10 text-green-400" },
  { icon: Bot, title: "Subagent Tracking", desc: "Explore every spawned agent and its work", color: "bg-amber-500/10 text-amber-400" },
  { icon: Zap, title: "Token Metrics", desc: "Input, output, cache reads/writes breakdown", color: "bg-violet-500/10 text-violet-400" },
  { icon: BarChart2, title: "Visual Charts", desc: "Bar and pie charts for usage patterns", color: "bg-cyan-500/10 text-cyan-400" },
  { icon: Clock, title: "Timeline View", desc: "Chronological view of all session activity", color: "bg-pink-500/10 text-pink-400" },
]

import React, { useState, useCallback, useRef } from "react"
import { FileUpload } from "@/components/upload/FileUpload"
import { SessionDashboard } from "@/components/dashboard/SessionDashboard"
import { analyzeFiles } from "@/utils/logParser"
import type { UploadedFile, ProjectAnalysis } from "@/types/logs"
import { LayoutDashboard, Upload, RotateCcw, AlertTriangle, CheckCircle2, X, ExternalLink, Shield, FolderOpen, MousePointerClick } from "lucide-react"
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
    <main className="min-h-screen flex flex-col items-center p-8 gap-12">
      {/* Hero */}
      <header className="flex flex-col items-center gap-3 text-center mt-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 border border-primary/20">
          <LayoutDashboard className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
          Claude Session Analyser
        </h1>
        <p className="mt-1 text-sm md:text-base text-muted-foreground max-w-2xl">
          A free, browser-based viewer for Claude Code session logs. Drop in your{" "}
          <span className="font-mono text-foreground">.jsonl</span> files to explore conversations,
          tool calls, subagents, and token usage — all processed locally, nothing uploaded.
        </p>
      </header>

      {/* Upload area */}
      <section aria-label="Upload Claude Code session logs" className="w-full">
        <FileUpload onFilesLoaded={handleFilesLoaded} />
      </section>

      {/* Features */}
      <section aria-labelledby="features-heading" className="w-full max-w-5xl">
        <h2 id="features-heading" className="text-base font-semibold text-foreground mb-3 text-center">
          What you can explore
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="flex items-start gap-4 rounded-xl border border-border p-5 bg-card"
            >
              <div className={`rounded-lg p-2.5 ${f.color} shrink-0`}>
                <f.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* How to use — detailed */}
      <section aria-labelledby="how-heading" className="w-full max-w-5xl">
        <h2 id="how-heading" className="text-base font-semibold text-foreground mb-3 text-center">
          How to use
        </h2>
        <ol className="flex flex-col gap-3">
          {HOW_TO_USE.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-lg border border-border bg-card p-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 border border-primary/20">
                <step.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground mb-1">
                  <span className="text-muted-foreground mr-1">{i + 1}.</span>{step.title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                {step.osPaths && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {step.osPaths.map((p) => (
                      <div key={p.os} className="rounded bg-muted/60 px-3 py-2">
                        <p className="text-[10px] font-semibold text-foreground/60 mb-1">{p.os}</p>
                        <code className="font-mono text-[11px] text-foreground/80 break-all">{p.path}</code>
                      </div>
                    ))}
                  </div>
                )}
                {step.code && (
                  <code className="mt-1.5 block rounded bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground/80 break-all">
                    {step.code}
                  </code>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Tips */}
      <section aria-labelledby="tips-heading" className="w-full max-w-5xl">
        <h2 id="tips-heading" className="text-base font-semibold text-foreground mb-3 text-center">
          Tips &amp; tricks
        </h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TIPS.map((tip) => (
            <li key={tip.title} className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-semibold text-foreground mb-1">{tip.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{tip.desc}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Privacy */}
      <section className="w-full max-w-5xl">
        <div className="flex items-start gap-3 rounded-lg border border-green-500/20 bg-green-500/5 p-4">
          <Shield className="h-4 w-4 text-green-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-green-300 mb-1">100% private — nothing leaves your browser</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              All parsing and analysis runs locally via WebAssembly and JavaScript. Your session logs
              contain sensitive conversation data — they are never sent to any server, API, or third-party
              service. No analytics, no telemetry, no cookies.
            </p>
          </div>
        </div>
      </section>

      {/* Footer — privacy note + developer */}
      <footer className="w-full max-w-5xl flex flex-col items-center gap-4 pb-4">
        <div className="w-full h-px bg-border" />
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xs text-muted-foreground">
            Built by{" "}
            <a
              href="https://www.linkedin.com/in/chandrashekhar-gouda/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-foreground/80 hover:text-primary transition-colors font-medium"
            >
              Chandrashekhar Gouda
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </p>
          <p className="text-xs text-muted-foreground">
            Open source · Free forever ·{" "}
            <a
              href="https://claude-session-analyser.pages.dev/"
              className="hover:text-foreground/80 transition-colors"
            >
              claude-session-analyser.pages.dev
            </a>
          </p>
        </div>
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

const HOW_TO_USE: { icon: React.ElementType; title: string; desc: string; code?: string; osPaths?: { os: string; path: string }[] }[] = [
  {
    icon: FolderOpen,
    title: "Find your Claude Code session logs",
    desc: "Claude Code saves every session as a .jsonl file inside a per-project folder. Each file is named by its UUID. Find it based on your OS:",
    osPaths: [
      { os: "Windows", path: "%USERPROFILE%\\.claude\\projects\\<project-slug>\\" },
      { os: "macOS", path: "~/.claude/projects/<project-slug>/" },
      { os: "Linux", path: "~/.claude/projects/<project-slug>/" },
    ],
  },
  {
    icon: Upload,
    title: "Drop or select the files",
    desc: "Click the upload area or drag-and-drop one or more .jsonl files directly. You can load a single session or multiple sessions at once — they will be merged and deduplicated automatically.",
  },
  {
    icon: MousePointerClick,
    title: "Select a session from the sidebar",
    desc: "After loading, the left sidebar lists every session with its date and token count. Click any row to open it. Use the tabs — Conversation, Tool Calls, Subagents, Tokens, Timeline — to explore different views.",
  },
  {
    icon: LayoutDashboard,
    title: "Add more files without losing context",
    desc: "Use the 'Add More Files' button in the top-right corner to load additional sessions on top of what's already open. This is useful for comparing sessions or loading subagent logs alongside the main session.",
  },
]

const TIPS = [
  {
    title: "Load the main session + subagent logs together",
    desc: "If Claude spawned subagents, each one has its own .jsonl. Load all of them at once to see the full call tree and accurate token totals across the entire run.",
  },
  {
    title: "Subagent-only warning banner",
    desc: "If you only load subagent files (no main UUID file), a warning banner appears at the top. Upload the parent session to get the complete picture.",
  },
  {
    title: "Use the Timeline tab for long sessions",
    desc: "The Timeline view shows every message and tool call in chronological order, making it easy to spot where time was spent or where a session went wrong.",
  },
  {
    title: "Token breakdown helps estimate costs",
    desc: "The Tokens tab shows input, output, cache-read, and cache-write counts separately. Cache reads are billed at 10% of input — the breakdown helps you understand your actual spend.",
  },
  {
    title: "Nothing is ever uploaded",
    desc: "All processing happens in your browser. You can disconnect from the internet after loading the page and it will still work — ideal for sensitive codebases.",
  },
  {
    title: "Reset and start fresh",
    desc: "Use the Reset button (top-right) to clear all loaded sessions and return to the upload screen without reloading the page.",
  },
]

import { useState, useMemo } from "react"
import { User, Copy, Check, Search, Terminal, Bot } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatTimestamp } from "@/utils/logParser"
import type { ParsedMessage, ContentBlock, SessionAnalysis } from "@/types/logs"

function isToolResultOnly(blocks: ContentBlock[]): boolean {
  const nonEmpty = blocks.filter((b) => {
    if (b.type === "tool_result") return true
    if (b.type === "text") return (b as { type: "text"; text: string }).text.trim().length > 0
    return false
  })
  return nonEmpty.length > 0 && nonEmpty.every((b) => b.type === "tool_result")
}

// Fully-injected messages with no user text
const SYSTEM_PREFIXES = [
  "<task-notification>",
  "<tool-call-result>",
  "<function_results>",
  "<search_results>",
  "<system>",
]
const SYSTEM_CONTENT_PATTERNS = [
  "This session is being continued from a previous conversation that ran out of context",
  "If you need specific details from before compaction",
]

// Tags that may appear before real user text — strip them, keep the rest
const STRIP_TAGS = [
  "ide_opened_file",
  "ide_selection",
  "user-prompt-submit-hook",
  "local-command-stdout",
  "local-command-caveat",
]

function stripContextTags(text: string): string {
  let result = text
  for (const tag of STRIP_TAGS) {
    result = result.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "g"), "")
  }
  return result.trim()
}

function isSystemInjected(text: string): boolean {
  const t = text.trimStart()
  if (SYSTEM_PREFIXES.some((p) => t.startsWith(p))) return true
  if (SYSTEM_CONTENT_PATTERNS.some((p) => t.includes(p))) return true
  return false
}

type PromptEntry = ParsedMessage & { displayText: string; responseModel?: string }

function extractUserPrompts(messages: ParsedMessage[]): PromptEntry[] {
  // Walk in chronological order so we can pair each user prompt with the model
  // of the next assistant message that responds to it (user messages have no model).
  const sorted = [...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const result: PromptEntry[] = []
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i]
    if (m.role !== "user" || m.isMeta || isToolResultOnly(m.contentBlocks)) continue
    const displayText = stripContextTags(m.textContent)
    if (displayText.length === 0 || isSystemInjected(displayText)) continue
    let responseModel: string | undefined
    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j]
      if (next.role === "assistant" && next.model && next.model !== "<synthetic>") {
        responseModel = next.model
        break
      }
    }
    result.push({ ...m, displayText, responseModel })
  }
  return result
}

function formatModelName(model: string): string {
  return model.replace(/^claude-/, "Claude ")
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function parseCommandMessage(text: string): { command: string; args: string } | null {
  const name = /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1]
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim()
  if (!name) return null
  return { command: name.trim(), args: args ?? "" }
}

function PromptText({ text }: { text: string }) {
  const cmd = parseCommandMessage(text)
  if (cmd) {
    return (
      <div className="flex items-start gap-2">
        <Terminal className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
        <div>
          <span className="font-mono text-sm text-violet-300">/{cmd.command}</span>
          {cmd.args && (
            <span className="ml-2 text-sm text-muted-foreground font-mono">{cmd.args}</span>
          )}
        </div>
      </div>
    )
  }
  return (
    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
      {text}
    </p>
  )
}

interface PromptsViewProps {
  session?: SessionAnalysis
  allSessions?: SessionAnalysis[]
}

export function PromptsView({ session, allSessions }: PromptsViewProps) {
  const [search, setSearch] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const isMultiSession = (allSessions?.length ?? 0) > 1

  const prompts = useMemo<(PromptEntry & { _sessionTitle: string | undefined })[]>(() => {
    if (isMultiSession && showAll && allSessions) {
      return allSessions
        .flatMap((s) =>
          extractUserPrompts(s.messages).map((m) => ({
            ...m,
            _sessionTitle: s.title as string | undefined,
          }))
        )
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    }
    const msgs = session?.messages ?? []
    return extractUserPrompts(msgs).map((m) => ({ ...m, _sessionTitle: undefined as string | undefined }))
  }, [session, allSessions, showAll, isMultiSession])

  const filtered = useMemo(() => {
    if (!search.trim()) return prompts
    const q = search.toLowerCase()
    return prompts.filter((p) => p.displayText.toLowerCase().includes(q))
  }, [prompts, search])

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  if (prompts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
        <User className="h-6 w-6 opacity-30" />
        <p className="text-sm">No user prompts found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <User className="h-3.5 w-3.5 text-blue-400" />
          <span className="font-semibold text-foreground">{prompts.length}</span>
          <span>prompt{prompts.length !== 1 ? "s" : ""}</span>
          {search && filtered.length !== prompts.length && (
            <span className="text-muted-foreground/60">· {filtered.length} matching</span>
          )}
        </div>

        {isMultiSession && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
              showAll
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {showAll ? "All Sessions" : "This Session"}
          </button>
        )}

        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search prompts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 rounded-md border border-border bg-secondary pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-56"
          />
        </div>
      </div>

      {/* Timeline list */}
      <ScrollArea className="flex-1">
        <div className="relative pr-4 pb-4">
          {/* Vertical line — left-[31px] = pl-4(16px) + w-[30px]/2(15px) */}
          <div className="absolute left-[31px] top-0 bottom-0 w-0.5 bg-border/60" />

          <div className="flex flex-col">
            {filtered.map((msg, i) => {
              const words = wordCount(msg.displayText)
              const isCopied = copiedId === msg.uuid
              const promptNum = prompts.indexOf(msg) + 1
              const sessionTitle = msg._sessionTitle

              return (
                <div key={`${msg.uuid}-${i}`} className="relative flex items-start gap-3 pl-4 pb-5 last:pb-0">
                  {/* Numbered dot */}
                  <div className="relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-2 border-blue-500/40 bg-blue-500/10 text-blue-400 text-[10px] font-bold leading-none mt-2">
                    #{promptNum}
                  </div>

                  {/* Prompt card */}
                  <div className="flex-1 min-w-0 rounded-xl border border-border bg-card px-4 py-3 group hover:border-blue-500/30 transition-colors">
                    {/* Meta row */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">{formatTimestamp(msg.timestamp)}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground/70">{words} word{words !== 1 ? "s" : ""}</span>
                      {msg.responseModel && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span
                            className="inline-flex items-center gap-1 text-xs text-violet-300/90 font-mono"
                            title={msg.responseModel}
                          >
                            <Bot className="h-3 w-3 text-violet-400" />
                            {formatModelName(msg.responseModel)}
                          </span>
                        </>
                      )}
                      {sessionTitle && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-xs text-amber-400/80 truncate max-w-[180px]" title={sessionTitle}>
                            {sessionTitle}
                          </span>
                        </>
                      )}
                      <button
                        onClick={() => handleCopy(msg.uuid, msg.displayText)}
                        className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {isCopied
                          ? <><Check className="h-3 w-3 text-green-400" /><span className="text-green-400">Copied</span></>
                          : <><Copy className="h-3 w-3" />Copy</>}
                      </button>
                    </div>

                    {/* Prompt text */}
                    <PromptText text={msg.displayText} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

import { User, Bot, Wrench, Brain, Bot as AgentIcon, Settings, FileText, Clock } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { formatTimestamp, formatDuration, formatNumber } from "@/utils/logParser"
import type { ParsedMessage, ContentBlock } from "@/types/logs"
import { cn } from "@/lib/utils"

function isToolResultOnly(blocks: ContentBlock[]): boolean {
  const nonEmpty = blocks.filter((b) => {
    if (b.type === "tool_result") return true
    if (b.type === "text") return (b as { type: "text"; text: string }).text.trim().length > 0
    return false
  })
  return nonEmpty.length > 0 && nonEmpty.every((b) => b.type === "tool_result")
}

type GapKind = "claude-gen" | "tool-exec" | "user-wait"

interface Gap {
  kind: GapKind
  ms: number
  fromTs: string
  toTs: string
}

function classifyGap(prev: ParsedMessage, next: ParsedMessage): Gap | null {
  const ms = new Date(next.timestamp).getTime() - new Date(prev.timestamp).getTime()
  if (ms <= 0) return null

  const prevIsAssistantWithTools = prev.role === "assistant" && prev.toolCalls.length > 0
  const nextIsToolResult = next.role === "user" && !next.isMeta && isToolResultOnly(next.contentBlocks)
  const prevIsToolResult = prev.role === "user" && !prev.isMeta && isToolResultOnly(prev.contentBlocks)
  const prevIsUser = prev.role === "user" && !prev.isMeta && !isToolResultOnly(prev.contentBlocks)

  const base = { ms, fromTs: prev.timestamp, toTs: next.timestamp }

  if (prevIsAssistantWithTools && nextIsToolResult) return { kind: "tool-exec", ...base }
  if ((prevIsUser || prevIsToolResult) && next.role === "assistant" && !next.isMeta) return { kind: "claude-gen", ...base }
  if (prev.role === "assistant" && !prev.isMeta && next.role === "user" && !next.isMeta && !nextIsToolResult) return { kind: "user-wait", ...base }
  return null
}

// ── Tooltip content builders ──────────────────────────────────────────────────

function TooltipRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground shrink-0 w-20">{label}</span>
      <span className={cn("font-medium text-foreground", className)}>{value}</span>
    </div>
  )
}

function AssistantTooltip({ message }: { message: ParsedMessage }) {
  const u = message.usage
  return (
    <div className="flex flex-col gap-1 min-w-[200px] max-w-xs">
      <div className="font-semibold text-violet-400 mb-1">Assistant</div>
      {message.model && <TooltipRow label="Model" value={message.model.replace("claude-", "Claude ")} />}
      <TooltipRow label="Time" value={formatTimestamp(message.timestamp)} />
      {u && (
        <>
          <div className="border-t border-border my-1" />
          <TooltipRow label="Input" value={`${formatNumber(u.input_tokens ?? 0)} tok`} />
          <TooltipRow label="Output" value={`${formatNumber(u.output_tokens ?? 0)} tok`} />
          {(u.cache_read_input_tokens ?? 0) > 0 && (
            <TooltipRow label="Cache read" value={`${formatNumber(u.cache_read_input_tokens ?? 0)} tok`} className="text-cyan-400" />
          )}
          {(u.cache_creation_input_tokens ?? 0) > 0 && (
            <TooltipRow label="Cache write" value={`${formatNumber(u.cache_creation_input_tokens ?? 0)} tok`} className="text-yellow-400" />
          )}
        </>
      )}
      {message.hasThinking && <TooltipRow label="Thinking" value="yes" className="text-pink-400" />}
      {message.toolCalls.length > 0 && (
        <>
          <div className="border-t border-border my-1" />
          <div className="text-muted-foreground mb-0.5">Tools called</div>
          {message.toolCalls.map((tc) => (
            <span key={tc.id} className="font-mono text-[11px] text-green-400">{tc.name}</span>
          ))}
        </>
      )}
      {message.textContent && (
        <>
          <div className="border-t border-border my-1" />
          <p className="text-muted-foreground leading-relaxed line-clamp-4 whitespace-normal">
            {message.textContent.slice(0, 300)}{message.textContent.length > 300 ? "…" : ""}
          </p>
        </>
      )}
    </div>
  )
}

function UserTooltip({ message }: { message: ParsedMessage }) {
  return (
    <div className="flex flex-col gap-1 min-w-[180px] max-w-xs">
      <div className="font-semibold text-blue-400 mb-1">User</div>
      <TooltipRow label="Time" value={formatTimestamp(message.timestamp)} />
      {message.textContent && (
        <>
          <div className="border-t border-border my-1" />
          <p className="text-muted-foreground leading-relaxed whitespace-normal line-clamp-6">
            {message.textContent.slice(0, 400)}{message.textContent.length > 400 ? "…" : ""}
          </p>
        </>
      )}
    </div>
  )
}

function ToolResultTooltip({ message }: { message: ParsedMessage }) {
  const results = message.contentBlocks.filter((b) => b.type === "tool_result") as Array<{
    type: "tool_result"
    tool_use_id?: string
    content?: string | Array<{ type: string; text?: string }>
  }>

  return (
    <div className="flex flex-col gap-1 min-w-[200px] max-w-xs">
      <div className="font-semibold text-cyan-400 mb-1">Tool Result</div>
      <TooltipRow label="Time" value={formatTimestamp(message.timestamp)} />
      <TooltipRow label="Results" value={`${results.length} block${results.length !== 1 ? "s" : ""}`} />
      {results.slice(0, 3).map((r, i) => {
        const text = typeof r.content === "string"
          ? r.content
          : Array.isArray(r.content)
            ? r.content.map((c) => c.text ?? "").join(" ")
            : ""
        return text ? (
          <div key={i} className="border-t border-border mt-1 pt-1">
            {r.tool_use_id && (
              <span className="font-mono text-[10px] text-muted-foreground">{r.tool_use_id.slice(0, 16)}</span>
            )}
            <p className="text-muted-foreground leading-relaxed whitespace-normal line-clamp-3 mt-0.5">
              {text.slice(0, 300)}{text.length > 300 ? "…" : ""}
            </p>
          </div>
        ) : null
      })}
    </div>
  )
}

function GapTooltip({ gap }: { gap: Gap }) {
  const labels: Record<GapKind, { title: string; color: string; desc: string }> = {
    "claude-gen": { title: "Claude generation", color: "text-violet-400", desc: "Time Claude spent thinking and generating the response" },
    "tool-exec":  { title: "Tool execution",    color: "text-cyan-400",   desc: "Time the tool took to run — Claude was idle" },
    "user-wait":  { title: "Waiting for user",  color: "text-muted-foreground", desc: "Time before the next user message" },
  }
  const { title, color, desc } = labels[gap.kind]
  return (
    <div className="flex flex-col gap-1 min-w-[180px] max-w-xs">
      <div className={cn("font-semibold mb-1", color)}>{title}</div>
      <TooltipRow label="Duration" value={formatDuration(gap.ms)} />
      <TooltipRow label="From" value={formatTimestamp(gap.fromTs)} />
      <TooltipRow label="To" value={formatTimestamp(gap.toTs)} />
      <div className="border-t border-border my-1" />
      <p className="text-muted-foreground whitespace-normal">{desc}</p>
    </div>
  )
}

// ── Main components ───────────────────────────────────────────────────────────

interface TimelineViewProps {
  messages: ParsedMessage[]
}

export function TimelineView({ messages }: TimelineViewProps) {
  const sorted = [...messages].sort((a, b) =>
    (a.timestamp > b.timestamp ? 1 : -1)
  )

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        No messages to display
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="relative py-4 pr-4">
        <div className="absolute left-7 top-4 bottom-4 w-0.5 bg-border" />

        <div className="flex flex-col gap-0">
          {sorted.map((msg, i) => {
            const next = sorted[i + 1]
            const gap = next ? classifyGap(msg, next) : null
            return (
              <div key={msg.uuid}>
                <TimelineEntry message={msg} isLast={i === sorted.length - 1 && !gap} />
                {gap && <GapIndicator gap={gap} />}
              </div>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}

function GapIndicator({ gap }: { gap: Gap }) {
  const configs: Record<GapKind, { label: string; bar: string; text: string }> = {
    "claude-gen": { label: "Claude",    bar: "bg-violet-500/30", text: "text-violet-400" },
    "tool-exec":  { label: "Tool exec", bar: "bg-cyan-500/30",   text: "text-cyan-400"   },
    "user-wait":  { label: "Waiting",   bar: "bg-muted/40",      text: "text-muted-foreground" },
  }

  const { label, bar, text } = configs[gap.kind]
  const width = Math.min(100, Math.max(4, Math.log10(Math.max(gap.ms, 10)) * 14))

  return (
    <div className="relative flex gap-4 pl-4 py-1">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center">
        <Tooltip content={<GapTooltip gap={gap} />} side="right">
          <Clock className={cn("h-2.5 w-2.5 cursor-default", text)} />
        </Tooltip>
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className={cn("h-1 rounded-full", bar)} style={{ width: `${width}px` }} />
        <span className={cn("text-[11px] font-mono tabular-nums", text)}>
          {label} · {formatDuration(gap.ms)}
        </span>
      </div>
    </div>
  )
}

function TimelineEntry({ message, isLast }: { message: ParsedMessage; isLast: boolean }) {
  const isMeta = message.isMeta
  const isSidechain = message.isSidechain
  const isToolReturn = message.role === "user" && !isMeta && isToolResultOnly(message.contentBlocks)
  const isUser = message.role === "user" && !isMeta && !isToolReturn
  const isAssistant = message.role === "assistant" && !isMeta
  const hasToolCalls = message.toolCalls.length > 0
  const hasThinking = message.hasThinking

  const dotColor = isMeta
    ? "bg-muted border-border"
    : isToolReturn
      ? "bg-cyan-500/20 border-cyan-500/40"
      : isUser
        ? "bg-blue-500/20 border-blue-500/40"
        : isSidechain
          ? "bg-amber-500/20 border-amber-500/40"
          : "bg-violet-500/20 border-violet-500/40"

  const icon = isMeta
    ? <Settings className="h-3 w-3 text-muted-foreground" />
    : isToolReturn
      ? <FileText className="h-3 w-3 text-cyan-400" />
      : isUser
        ? <User className="h-3 w-3 text-blue-400" />
        : isSidechain
          ? <AgentIcon className="h-3 w-3 text-amber-400" />
          : <Bot className="h-3 w-3 text-violet-400" />

  const label = isMeta ? "System" : isToolReturn ? "Tool Result" : isUser ? "User" : isSidechain ? "Subagent" : "Assistant"

  const tooltipContent = isAssistant
    ? <AssistantTooltip message={message} />
    : isUser
      ? <UserTooltip message={message} />
      : isToolReturn
        ? <ToolResultTooltip message={message} />
        : null

  return (
    <div className={cn("relative flex gap-4 pl-4 pb-4", isLast && "pb-0")}>
      {/* Dot — wrapped in tooltip */}
      <Tooltip content={tooltipContent} side="right">
        <div className={cn(
          "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 cursor-default",
          dotColor
        )}>
          {icon}
        </div>
      </Tooltip>

      {/* Content */}
      <div className={cn("flex-1 min-w-0 pt-0.5", (isMeta || isToolReturn) && "opacity-50")}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground">{label}</span>
          <span className="text-xs text-muted-foreground">{formatTimestamp(message.timestamp)}</span>

          {hasThinking && (
            <Badge variant="default" className="text-xs py-0 gap-0.5">
              <Brain className="h-2.5 w-2.5 mr-0.5" />Thinking
            </Badge>
          )}
          {hasToolCalls && (
            <Badge variant="success" className="text-xs py-0 gap-0.5">
              <Wrench className="h-2.5 w-2.5 mr-0.5" />{message.toolCalls.length} tool{message.toolCalls.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {message.agentId && (
            <Badge variant="warning" className="text-xs py-0 font-mono">
              {message.agentId.slice(0, 8)}
            </Badge>
          )}
        </div>

        {hasToolCalls && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.toolCalls.map((tc) => (
              <span
                key={tc.id}
                className="inline-flex items-center gap-1 text-[11px] font-mono text-green-400 bg-green-500/10 rounded px-1.5 py-0.5"
              >
                {tc.name}
              </span>
            ))}
          </div>
        )}

        {message.textContent && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {message.textContent}
          </p>
        )}
      </div>
    </div>
  )
}

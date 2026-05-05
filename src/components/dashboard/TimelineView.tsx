import { User, Bot, Wrench, Brain, Bot as AgentIcon, Settings, FileText } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { formatTimestamp } from "@/utils/logParser"
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
        {/* Vertical line — left-7 = 28px aligns to dot center (pl-4=16px + w-6/2=12px) */}
        <div className="absolute left-7 top-4 bottom-4 w-0.5 bg-border" />

        <div className="flex flex-col gap-0">
          {sorted.map((msg, i) => (
            <TimelineEntry key={msg.uuid} message={msg} isLast={i === sorted.length - 1} />
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}

function TimelineEntry({ message, isLast }: { message: ParsedMessage; isLast: boolean }) {
  const isMeta = message.isMeta
  const isSidechain = message.isSidechain
  const isToolReturn = message.role === "user" && !isMeta && isToolResultOnly(message.contentBlocks)
  const isUser = message.role === "user" && !isMeta && !isToolReturn
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

  return (
    <div className={cn("relative flex gap-4 pl-4 pb-4", isLast && "pb-0")}>
      {/* Dot */}
      <div className={cn("relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2", dotColor)}>
        {icon}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0 pt-0.5", (isMeta || isToolReturn) && "opacity-50")}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground">
            {label}
          </span>
          <span className="text-xs text-muted-foreground">{formatTimestamp(message.timestamp)}</span>

          {/* Badges for special content */}
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

        {/* Tool call names */}
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

        {/* Text preview */}
        {message.textContent && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {message.textContent}
          </p>
        )}
      </div>
    </div>
  )
}

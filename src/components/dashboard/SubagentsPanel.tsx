import { useState } from "react"
import { Bot, ChevronDown, ChevronRight, Wrench, MessageSquare, Zap, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ConversationView } from "@/components/dashboard/ConversationView"
import { formatNumber, formatDuration } from "@/utils/logParser"
import type { SubagentInfo } from "@/types/logs"

const AGENT_TYPE_COLORS: Record<string, string> = {
  Explore: "success",
  "general-purpose": "default",
  Plan: "warning",
  "code-reviewer": "destructive",
  "claude-code-guide": "secondary",
  "statusline-setup": "secondary",
}

interface SubagentsPanelProps {
  subagents: SubagentInfo[]
}

export function SubagentsPanel({ subagents }: SubagentsPanelProps) {
  const [selected, setSelected] = useState<string | null>(null)

  if (subagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
        <Bot className="h-8 w-8 opacity-30" />
        <p className="text-sm">No subagents in this session</p>
      </div>
    )
  }

  const selectedAgent = subagents.find((a) => a.agentId === selected)
  const hasMessages = selectedAgent && selectedAgent.messages.length > 0

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5" /> Subagents ({subagents.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {subagents.map((agent) => (
              <AgentRow
                key={agent.agentId}
                agent={agent}
                selected={selected === agent.agentId}
                onSelect={() => setSelected(selected === agent.agentId ? null : agent.agentId)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedAgent && (
        <Card className="overflow-hidden flex flex-col" style={{ minHeight: "320px" }}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5" />
              {selectedAgent.description ?? `Agent ${selectedAgent.agentId.slice(0, 8)}`}
              {selectedAgent.type && (
                <Badge variant={(AGENT_TYPE_COLORS[selectedAgent.type] as "default" | "success" | "warning" | "destructive" | "secondary" | "outline") ?? "default"}>
                  {selectedAgent.type}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <div className="flex-1 overflow-hidden">
            {hasMessages ? (
              <ConversationView messages={selectedAgent.messages} showSidechain />
            ) : (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground px-6 text-center">
                <Bot className="h-8 w-8 opacity-20" />
                <div>
                  <p className="text-sm font-medium text-foreground/70">No conversation log for this agent</p>
                  <p className="text-xs mt-1">
                    Upload the corresponding <span className="font-mono text-amber-400">agent-{selectedAgent.agentId}.jsonl</span> file
                    from the session subfolder to see this agent's full conversation.
                  </p>
                  <p className="text-xs mt-1 text-muted-foreground/60">
                    Location: <span className="font-mono">&lt;project&gt;\{selectedAgent.agentId.slice(0,8)}...\subagents\</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

function AgentRow({
  agent,
  selected,
  onSelect,
}: {
  agent: SubagentInfo
  selected: boolean
  onSelect: () => void
}) {
  const agentType = agent.type ?? "unknown"
  const colorVariant = (AGENT_TYPE_COLORS[agentType] ?? "default") as "default" | "success" | "warning" | "destructive" | "secondary" | "outline"
  const duration = agent.startTime && agent.endTime
    ? new Date(agent.endTime).getTime() - new Date(agent.startTime).getTime()
    : 0

  return (
    <button
      className="w-full flex items-start gap-3 p-3 hover:bg-secondary/50 transition-colors text-left"
      onClick={onSelect}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 mt-0.5">
        <Bot className="h-3.5 w-3.5 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={colorVariant}>{agentType}</Badge>
          <span className="text-xs text-foreground truncate">
            {agent.description ?? agent.agentId.slice(0, 16)}
          </span>
          {selected
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />}
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {agent.messages.length} msgs
          </span>
          <span className="flex items-center gap-1">
            <Wrench className="h-3 w-3" />
            {agent.toolCallCount} tools
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {formatNumber(agent.tokenUsage.totalTokens)} tok
          </span>
          {duration > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(duration)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

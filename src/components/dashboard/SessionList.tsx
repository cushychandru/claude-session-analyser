import { Clock, MessageSquare, Wrench, Bot, GitBranch, Brain, Monitor } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDuration, formatTimestamp, formatNumber } from "@/utils/logParser"
import type { SessionAnalysis } from "@/types/logs"
import { cn } from "@/lib/utils"

interface SessionListProps {
  sessions: SessionAnalysis[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
}

export function SessionList({ sessions, selectedSessionId, onSelectSession }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
        No sessions loaded
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => (
        <SessionCard
          key={session.sessionId}
          session={session}
          selected={session.sessionId === selectedSessionId}
          onClick={() => onSelectSession(session.sessionId)}
        />
      ))}
    </div>
  )
}

function SessionCard({
  session,
  selected,
  onClick,
}: {
  session: SessionAnalysis
  selected: boolean
  onClick: () => void
}) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:border-primary/40",
        selected && "border-primary/60 bg-primary/5"
      )}
      onClick={onClick}
    >
      <div className="p-3">
        {/* Title */}
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground line-clamp-1 flex-1">
            {session.title}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            {session.hasThinking && (
              <span title="Extended thinking">
                <Brain className="h-3.5 w-3.5 text-violet-400" />
              </span>
            )}
            {session.entrypoint && (
              <Badge variant="outline" className="text-xs py-0">
                {session.entrypoint.replace("claude-", "")}
              </Badge>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimestamp(session.startTime)}
          </span>
          {session.duration > 0 && (
            <span className="flex items-center gap-1">
              <Monitor className="h-3 w-3" />
              {formatDuration(session.duration)}
            </span>
          )}
          {session.gitBranch && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {session.gitBranch}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-blue-400">
            <MessageSquare className="h-3 w-3" />
            {session.messageCount.total} msgs
          </span>
          <span className="flex items-center gap-1 text-green-400">
            <Wrench className="h-3 w-3" />
            {session.toolCalls.length} tools
          </span>
          {session.subagents.length > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <Bot className="h-3 w-3" />
              {session.subagents.length} agents
            </span>
          )}
          <span className="ml-auto text-muted-foreground font-mono">
            {formatNumber(session.tokenUsage.totalTokens)} tok
          </span>
        </div>

        {/* CWD */}
        {session.cwd && (
          <p className="mt-1.5 text-xs text-muted-foreground/60 font-mono truncate">
            {session.cwd}
          </p>
        )}
      </div>
    </Card>
  )
}

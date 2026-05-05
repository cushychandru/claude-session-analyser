import { useState } from "react"
import { Wrench, ChevronRight, ChevronDown, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatTimestamp } from "@/utils/logParser"
import type { ParsedToolCall, SessionAnalysis, ProjectAnalysis } from "@/types/logs"

interface ToolCallsPanelProps {
  session?: SessionAnalysis
  project?: ProjectAnalysis
}

export function ToolCallsPanel({ session, project }: ToolCallsPanelProps) {
  const toolFreq = session?.toolCallFrequency ?? project?.toolCallFrequency ?? {}
  const toolCalls = session?.toolCalls ?? []

  const sorted = Object.entries(toolFreq)
    .sort(([, a], [, b]) => b - a)

  const maxCount = sorted[0]?.[1] ?? 1

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Frequency chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5" /> Tool Usage Frequency
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tool calls recorded</p>
          ) : (
            <div className="space-y-2.5">
              {sorted.map(([name, count]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="w-48 text-xs font-mono text-foreground truncate shrink-0" title={name}>{name}</span>
                  <div className="flex-1">
                    <Progress value={count} max={maxCount} barClassName="bg-green-500" />
                  </div>
                  <Badge variant="success" className="shrink-0 tabular-nums">{count}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Call log */}
      {toolCalls.length > 0 && (
        <Card className="flex-1 overflow-hidden flex flex-col">
          <CardHeader>
            <CardTitle>Tool Call Log ({toolCalls.length})</CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <div className="divide-y divide-border">
              {toolCalls.map((tc) => (
                <ToolCallRow key={tc.id} toolCall={tc} />
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}
    </div>
  )
}

function ToolCallRow({ toolCall }: { toolCall: ParsedToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const inputStr = JSON.stringify(toolCall.input, null, 2)
  const hasResult = !!toolCall.result

  return (
    <div className="p-3">
      <button
        className="flex items-center gap-2.5 w-full"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <Badge variant="success" className="font-mono shrink-0">{toolCall.name}</Badge>
        <span className="flex-1 text-xs text-muted-foreground truncate text-left">
          {Object.entries(toolCall.input)
            .slice(0, 2)
            .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`)
            .join(" ")}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Clock className="h-3 w-3" />
          {formatTimestamp(toolCall.timestamp)}
        </span>
        {hasResult && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Has result" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 pl-6">
          <div className="tool-use-block rounded p-2">
            <p className="text-xs text-green-400 font-medium mb-1">Input</p>
            <pre className="text-[11px] font-mono text-muted-foreground overflow-x-auto">{inputStr}</pre>
          </div>
          {toolCall.result && (
            <div className="tool-result-block rounded p-2">
              <p className="text-xs text-cyan-400 font-medium mb-1">Result</p>
              <pre className="text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                {toolCall.result.slice(0, 2000)}{toolCall.result.length > 2000 ? "…" : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import {
  MessageSquare, Wrench, Zap, Clock, Bot, GitBranch, Brain,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatNumber, formatDuration } from "@/utils/logParser"
import type { ProjectAnalysis, TokenUsageSummary } from "@/types/logs"

function emptyTokens(): TokenUsageSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
  }
}

function addTokens(a: TokenUsageSummary, b: TokenUsageSummary): TokenUsageSummary {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    webFetchRequests: a.webFetchRequests + b.webFetchRequests,
  }
}

interface MetricCardProps {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  color: string
}

function MetricCard({ label, value, sub, icon, color }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className={`rounded-lg p-2 ${color}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface MetricsOverviewProps {
  analysis: ProjectAnalysis
}

export function MetricsOverview({ analysis }: MetricsOverviewProps) {
  const { totalSessions, totalMessages, totalToolCalls, totalTokens, totalSubagents } = analysis

  const totalDuration = analysis.sessions.reduce((n, s) => n + s.duration, 0)
  const avgDuration = totalSessions > 0 ? totalDuration / totalSessions : 0

  const totalInputSide = totalTokens.inputTokens + totalTokens.cacheReadTokens + totalTokens.cacheCreationTokens
  const cacheHitPct = totalInputSide > 0
    ? Math.round((totalTokens.cacheReadTokens / totalInputSide) * 100)
    : 0

  const hasThinkingSessions = analysis.sessions.filter((s) => s.hasThinking).length

  // Aggregate subagent tokens across all sessions
  const allSubagents = analysis.sessions.flatMap((s) => s.subagents)
  const subagentTokens = allSubagents.reduce((acc, a) => addTokens(acc, a.tokenUsage), emptyTokens())
  const mainTokens: TokenUsageSummary = {
    inputTokens: totalTokens.inputTokens - subagentTokens.inputTokens,
    outputTokens: totalTokens.outputTokens - subagentTokens.outputTokens,
    cacheCreationTokens: totalTokens.cacheCreationTokens - subagentTokens.cacheCreationTokens,
    cacheReadTokens: totalTokens.cacheReadTokens - subagentTokens.cacheReadTokens,
    totalTokens: totalTokens.totalTokens - subagentTokens.totalTokens,
    webSearchRequests: totalTokens.webSearchRequests - subagentTokens.webSearchRequests,
    webFetchRequests: totalTokens.webFetchRequests - subagentTokens.webFetchRequests,
  }

  // Per agent-type token aggregation
  const agentTypeTokens: Record<string, { tokens: TokenUsageSummary; count: number; toolCalls: number }> = {}
  for (const agent of allSubagents) {
    const key = agent.type ?? "unknown"
    if (!agentTypeTokens[key]) agentTypeTokens[key] = { tokens: emptyTokens(), count: 0, toolCalls: 0 }
    agentTypeTokens[key].tokens = addTokens(agentTypeTokens[key].tokens, agent.tokenUsage)
    agentTypeTokens[key].count++
    agentTypeTokens[key].toolCalls += agent.toolCallCount
  }
  const agentTypeRows = Object.entries(agentTypeTokens).sort((a, b) => b[1].tokens.totalTokens - a[1].tokens.totalTokens)

  const barTotal = totalTokens.inputTokens + totalTokens.outputTokens + totalTokens.cacheReadTokens + totalTokens.cacheCreationTokens

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard
          label="Sessions"
          value={String(totalSessions)}
          icon={<GitBranch className="h-4 w-4 text-violet-400" />}
          color="bg-violet-500/10"
        />
        <MetricCard
          label="Messages"
          value={formatNumber(totalMessages)}
          sub={`${analysis.sessions[0]?.messageCount.user ?? 0} user turns avg`}
          icon={<MessageSquare className="h-4 w-4 text-blue-400" />}
          color="bg-blue-500/10"
        />
        <MetricCard
          label="Tool Calls"
          value={formatNumber(totalToolCalls)}
          sub={`${analysis.topTools[0]?.name ?? "—"} top tool`}
          icon={<Wrench className="h-4 w-4 text-green-400" />}
          color="bg-green-500/10"
        />
        <MetricCard
          label="Subagents"
          value={String(totalSubagents)}
          sub={totalSubagents > 0 ? `${formatNumber(subagentTokens.totalTokens)} tokens` : undefined}
          icon={<Bot className="h-4 w-4 text-amber-400" />}
          color="bg-amber-500/10"
        />
        <MetricCard
          label="Total Tokens"
          value={formatNumber(totalTokens.totalTokens)}
          sub={`${cacheHitPct}% cache hits`}
          icon={<Zap className="h-4 w-4 text-cyan-400" />}
          color="bg-cyan-500/10"
        />
        <MetricCard
          label="Avg Duration"
          value={formatDuration(avgDuration)}
          sub={`${hasThinkingSessions} extended-thinking`}
          icon={<Clock className="h-4 w-4 text-pink-400" />}
          color="bg-pink-500/10"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Token breakdown bar */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" /> Token Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <TokenBar label="Input" value={totalTokens.inputTokens} total={barTotal} color="bg-blue-500" />
              <TokenBar label="Output" value={totalTokens.outputTokens} total={barTotal} color="bg-violet-500" />
              <TokenBar label="Cache Read" value={totalTokens.cacheReadTokens} total={barTotal} color="bg-green-500" />
              <TokenBar label="Cache Write" value={totalTokens.cacheCreationTokens} total={barTotal} color="bg-amber-500" />
            </div>
            {/* Main vs Subagent split */}
            {totalSubagents > 0 && (
              <div className="mt-4 pt-3 border-t border-border space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Main vs Subagent Split</p>
                {mainTokens.totalTokens > 0 && (
                  <TokenBar label="Main" value={mainTokens.totalTokens} total={totalTokens.totalTokens} color="bg-blue-500" />
                )}
                <TokenBar label="Subagents" value={subagentTokens.totalTokens} total={totalTokens.totalTokens} color="bg-amber-500" />
              </div>
            )}
            {hasThinkingSessions > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Brain className="h-3.5 w-3.5 text-violet-400" />
                <span>{hasThinkingSessions} session{hasThinkingSessions !== 1 ? "s" : ""} used extended thinking</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subagent analytics */}
        {totalSubagents > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5" /> Subagent Analytics
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {totalSubagents} agent{totalSubagents !== 1 ? "s" : ""} · {formatNumber(subagentTokens.totalTokens)} total tokens
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {agentTypeRows.map(([type, data]) => (
                  <div key={type} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
                    <Badge variant="outline" className="font-mono text-[10px] shrink-0">{type}</Badge>
                    <span className="text-xs text-muted-foreground w-12 shrink-0">{data.count}×</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-foreground font-mono">{formatNumber(data.tokens.totalTokens)} tok</span>
                        <span className="text-muted-foreground">{formatNumber(data.toolCalls)} tools</span>
                        <span className="text-muted-foreground/60 text-[10px]">
                          {data.tokens.inputTokens > 0 ? `in:${formatNumber(data.tokens.inputTokens)}` : ""}
                          {data.tokens.outputTokens > 0 ? ` out:${formatNumber(data.tokens.outputTokens)}` : ""}
                        </span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${subagentTokens.totalTokens > 0 ? (data.tokens.totalTokens / subagentTokens.totalTokens) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-2 border-t border-border grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Input</p>
                  <p className="font-mono text-foreground">{formatNumber(subagentTokens.inputTokens)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Output</p>
                  <p className="font-mono text-foreground">{formatNumber(subagentTokens.outputTokens)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cache Read</p>
                  <p className="font-mono text-foreground">{formatNumber(subagentTokens.cacheReadTokens)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function TokenBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right text-xs text-foreground font-mono">
        {formatNumber(value)}
      </span>
      <span className="w-10 text-right text-xs text-muted-foreground">
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

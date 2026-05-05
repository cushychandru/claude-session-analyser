import { useState, useEffect } from "react"
import { LayoutDashboard, MessageSquare, Wrench, Bot, BarChart2, Clock, Zap, User, DollarSign } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MetricsOverview } from "@/components/dashboard/MetricsOverview"
import { SessionList } from "@/components/dashboard/SessionList"
import { ConversationView } from "@/components/dashboard/ConversationView"
import { ToolCallsPanel } from "@/components/dashboard/ToolCallsPanel"
import { SubagentsPanel } from "@/components/dashboard/SubagentsPanel"
import { TokenUsageChart } from "@/components/dashboard/TokenUsageChart"
import { TimelineView } from "@/components/dashboard/TimelineView"
import { PromptsView } from "@/components/dashboard/PromptsView"
import { CostBreakdownView } from "@/components/dashboard/CostBreakdownView"
import { Badge } from "@/components/ui/badge"
import { SessionGitGraph } from "@/components/dashboard/SessionGitGraph"
import { formatNumber, formatDuration } from "@/utils/logParser"
import type { ProjectAnalysis, SessionAnalysis } from "@/types/logs"

interface SessionDashboardProps {
  analysis: ProjectAnalysis
}

export function SessionDashboard({ analysis }: SessionDashboardProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    analysis.sessions[0]?.sessionId ?? null
  )
  const [tab, setTab] = useState("overview")

  // When analysis changes (more files added), reset to first session if current selection is stale
  useEffect(() => {
    const stillValid = analysis.sessions.some((s) => s.sessionId === selectedSessionId)
    if (!stillValid && analysis.sessions.length > 0) {
      setSelectedSessionId(analysis.sessions[0].sessionId)
    }
  }, [analysis, selectedSessionId])

  // Fallback: if selectedSessionId doesn't match any session, use first
  const selectedSession: SessionAnalysis | undefined =
    analysis.sessions.find((s) => s.sessionId === selectedSessionId) ??
    analysis.sessions[0]

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar – session list */}
      <aside className="w-72 shrink-0 border-r border-border flex flex-col bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h1 className="text-sm font-bold text-foreground flex items-center gap-2">
            <div className="h-5 w-5 rounded bg-primary/20 flex items-center justify-center">
              <LayoutDashboard className="h-3 w-3 text-primary" />
            </div>
            Claude Session Analyser
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {analysis.totalSessions} session{analysis.totalSessions !== 1 ? "s" : ""} loaded
          </p>
        </div>
        <ScrollArea className="flex-1 p-2">
          <SessionList
            sessions={analysis.sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
          />
        </ScrollArea>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="shrink-0 px-4">
            <TabsTrigger value="overview">
              <LayoutDashboard className="h-3.5 w-3.5" />Overview
            </TabsTrigger>
            <TabsTrigger value="conversation">
              <MessageSquare className="h-3.5 w-3.5" />Conversation
            </TabsTrigger>
            <TabsTrigger value="tools">
              <Wrench className="h-3.5 w-3.5" />Tools
            </TabsTrigger>
            <TabsTrigger value="subagents">
              <Bot className="h-3.5 w-3.5" />
              Subagents
              {selectedSession && selectedSession.subagents.length > 0 && (
                <span className="bg-amber-500/20 text-amber-400 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                  {selectedSession.subagents.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="charts">
              <BarChart2 className="h-3.5 w-3.5" />Charts
            </TabsTrigger>
            <TabsTrigger value="timeline">
              <Clock className="h-3.5 w-3.5" />Timeline
            </TabsTrigger>
            <TabsTrigger value="prompts">
              <User className="h-3.5 w-3.5" />Prompts
            </TabsTrigger>
            <TabsTrigger value="cost">
              <DollarSign className="h-3.5 w-3.5" />Cost
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-auto p-4">
            <MetricsOverview analysis={analysis} />
            {selectedSession && (
              <div className="mt-4 space-y-3">
                <div className="p-4 rounded-lg border border-border bg-card">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                    Selected Session Details
                  </h3>
                  <SessionDetailGrid session={selectedSession} />
                </div>
                {selectedSession.subagents.length > 0 && (
                  <div className="p-4 rounded-lg border border-border bg-card">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3 flex items-center gap-2">
                      <Bot className="h-3.5 w-3.5 text-amber-400" />
                      Subagents in this Session
                      <span className="ml-auto font-normal normal-case text-muted-foreground">
                        {selectedSession.subagents.length} agent{selectedSession.subagents.length !== 1 ? "s" : ""}
                      </span>
                    </h3>
                    <SessionSubagentTable session={selectedSession} />
                  </div>
                )}
                <SessionGitGraph session={selectedSession} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="conversation" className="flex-1 overflow-hidden">
            {selectedSession ? (
              <ConversationView
                messages={selectedSession.messages}
                title={selectedSession.title}
              />
            ) : (
              <EmptyState message="Select a session from the sidebar" />
            )}
          </TabsContent>

          <TabsContent value="tools" className="flex-1 overflow-auto p-4">
            {selectedSession ? (
              <ToolCallsPanel session={selectedSession} />
            ) : (
              <ToolCallsPanel project={analysis} />
            )}
          </TabsContent>

          <TabsContent value="subagents" className="flex-1 overflow-auto p-4">
            {selectedSession ? (
              <SubagentsPanel subagents={selectedSession.subagents} />
            ) : (
              <EmptyState message="Select a session to view subagents" />
            )}
          </TabsContent>

          <TabsContent value="charts" className="flex-1 overflow-auto p-4">
            <TokenUsageChart project={analysis} selectedSession={selectedSession} />
          </TabsContent>

          <TabsContent value="timeline" className="flex-1 overflow-hidden p-4">
            {selectedSession ? (
              <div className="h-full">
                <TimelineView messages={selectedSession.messages} />
              </div>
            ) : (
              <EmptyState message="Select a session to view timeline" />
            )}
          </TabsContent>

          <TabsContent value="prompts" className="flex-1 overflow-hidden p-4">
            {selectedSession ? (
              <PromptsView session={selectedSession} allSessions={analysis.sessions} />
            ) : (
              <EmptyState message="Select a session to view prompts" />
            )}
          </TabsContent>

          <TabsContent value="cost" className="flex-1 overflow-hidden p-4">
            <CostBreakdownView project={analysis} selectedSession={selectedSession} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
      {message}
    </div>
  )
}

function SessionDetailGrid({ session }: { session: SessionAnalysis }) {
  const subagentTokens = session.subagents.reduce(
    (acc, a) => ({ input: acc.input + a.tokenUsage.inputTokens, output: acc.output + a.tokenUsage.outputTokens, total: acc.total + a.tokenUsage.totalTokens }),
    { input: 0, output: 0, total: 0 }
  )
  const rows = [
    { label: "Session ID", value: session.sessionId },
    { label: "Branch", value: session.gitBranch || "—" },
    { label: "Working Dir", value: session.cwd || "—" },
    { label: "Entrypoint", value: session.entrypoint || "—" },
    { label: "Version", value: session.version || "—" },
    { label: "User Messages", value: String(session.messageCount.user) },
    { label: "Assistant Messages", value: String(session.messageCount.assistant) },
    { label: "Tool Calls", value: String(session.toolCalls.length) },
    { label: "Subagents", value: String(session.subagents.length) },
    { label: "Total Tokens", value: session.tokenUsage.totalTokens.toLocaleString() },
    { label: "Input Tokens", value: session.tokenUsage.inputTokens.toLocaleString() },
    { label: "Output Tokens", value: session.tokenUsage.outputTokens.toLocaleString() },
    { label: "Cache Read", value: session.tokenUsage.cacheReadTokens.toLocaleString() },
    ...(session.subagents.length > 0 ? [
      { label: "Subagent Tokens", value: subagentTokens.total.toLocaleString() },
      { label: "Subagent Input", value: subagentTokens.input.toLocaleString() },
      { label: "Subagent Output", value: subagentTokens.output.toLocaleString() },
    ] : []),
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
      {rows.map((r) => (
        <div key={r.label}>
          <p className="text-xs text-muted-foreground">{r.label}</p>
          <p className="text-xs font-mono text-foreground truncate" title={r.value}>{r.value}</p>
        </div>
      ))}
    </div>
  )
}

function SessionSubagentTable({ session }: { session: SessionAnalysis }) {
  const totalSubagentTokens = session.subagents.reduce((n, a) => n + a.tokenUsage.totalTokens, 0)

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-1 pb-1 border-b border-border text-[10px] text-muted-foreground uppercase font-medium">
        <span>Agent</span>
        <span className="text-right w-14">Messages</span>
        <span className="text-right w-12">Tools</span>
        <span className="text-right w-20">Tokens</span>
        <span className="text-right w-20">Share</span>
      </div>
      {session.subagents.map((agent) => {
        const sharePct = totalSubagentTokens > 0
          ? ((agent.tokenUsage.totalTokens / totalSubagentTokens) * 100).toFixed(0)
          : "0"
        const duration = agent.startTime && agent.endTime
          ? new Date(agent.endTime).getTime() - new Date(agent.startTime).getTime()
          : 0

        return (
          <div key={agent.agentId} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-1 py-1.5 rounded hover:bg-secondary/30 transition-colors items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                  {agent.type ?? "unknown"}
                </Badge>
                <span className="text-xs text-muted-foreground truncate">
                  {agent.description ?? agent.agentId.slice(0, 12)}
                </span>
              </div>
              {duration > 0 && (
                <span className="text-[10px] text-muted-foreground/60 ml-0.5">{formatDuration(duration)}</span>
              )}
            </div>
            <span className="text-xs text-right w-14 font-mono text-muted-foreground">{agent.messages.length}</span>
            <span className="text-xs text-right w-12 font-mono text-muted-foreground">{agent.toolCallCount}</span>
            <div className="text-right w-20">
              <span className="text-xs font-mono text-foreground flex items-center justify-end gap-1">
                <Zap className="h-2.5 w-2.5 text-amber-400" />
                {formatNumber(agent.tokenUsage.totalTokens)}
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                in:{formatNumber(agent.tokenUsage.inputTokens)} out:{formatNumber(agent.tokenUsage.outputTokens)}
              </span>
            </div>
            <div className="w-20">
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-[10px] text-muted-foreground">{sharePct}%</span>
              </div>
              <div className="h-1 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${sharePct}%` }} />
              </div>
            </div>
          </div>
        )
      })}
      {/* Total row */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-1 pt-2 border-t border-border items-center">
        <span className="text-xs font-semibold text-muted-foreground">Total</span>
        <span className="text-xs text-right w-14 font-mono">
          {session.subagents.reduce((n, a) => n + a.messages.length, 0)}
        </span>
        <span className="text-xs text-right w-12 font-mono">
          {session.subagents.reduce((n, a) => n + a.toolCallCount, 0)}
        </span>
        <span className="text-xs text-right w-20 font-mono text-foreground font-semibold flex items-center justify-end gap-1">
          <Zap className="h-2.5 w-2.5 text-amber-400" />
          {formatNumber(totalSubagentTokens)}
        </span>
        <span className="text-xs text-right w-20 font-mono text-muted-foreground">100%</span>
      </div>
    </div>
  )
}

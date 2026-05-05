import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatNumber, formatDuration } from "@/utils/logParser"
import {
  Zap, Wrench, MessageSquare, Bot, Clock, Brain,
  GitBranch, BarChart2, DollarSign, TrendingUp, Activity,
} from "lucide-react"
import type { ProjectAnalysis, SessionAnalysis } from "@/types/logs"
import { SessionGitGraph } from "@/components/dashboard/SessionGitGraph"

// ── Shared chart constants ────────────────────────────────────────────────────
const CHART_STYLE = {
  background: "hsl(222 47% 13%)",
  border: "1px solid hsl(216 34% 17%)",
  borderRadius: 6,
  color: "hsl(213 31% 91%)",
  fontSize: 12,
}
const CURSOR = { fill: "hsl(216 34% 17%)", opacity: 0.6 }
const GRID   = "hsl(216 34% 17%)"
const TICK   = { fill: "hsl(215 20% 55%)", fontSize: 10 }
const LEGEND = { fontSize: 11, color: "hsl(215 20% 55%)" }
const COLORS = ["#8b5cf6","#3b82f6","#22c55e","#f59e0b","#ef4444","#ec4899","#06b6d4","#a78bfa","#34d399"]

// ── Per-model pricing (per million tokens) ────────────────────────────────────
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  opus:   { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  sonnet: { input:  3.00, output: 15.00, cacheRead: 0.30, cacheWrite:  3.75 },
  haiku:  { input:  0.80, output:  4.00, cacheRead: 0.08, cacheWrite:  1.00 },
}
function modelPricing(model?: string) {
  const m = (model ?? "").toLowerCase()
  if (m.includes("opus"))  return MODEL_PRICING.opus
  if (m.includes("haiku")) return MODEL_PRICING.haiku
  return MODEL_PRICING.sonnet
}
// Cost from individual messages (uses actual model per turn)
function estimateSessionCost(session: SessionAnalysis): number {
  let cost = 0
  const allMessages = [
    ...session.messages,
    ...session.subagents.flatMap((a) => a.messages),
  ]
  for (const msg of allMessages) {
    if (msg.role !== "assistant" || !msg.usage) continue
    const p = modelPricing(msg.model)
    cost += (msg.usage.input_tokens  ?? 0) * p.input    / 1_000_000
    cost += (msg.usage.output_tokens ?? 0) * p.output   / 1_000_000
    cost += (msg.usage.cache_read_input_tokens    ?? 0) * p.cacheRead  / 1_000_000
    cost += (msg.usage.cache_creation_input_tokens ?? 0) * p.cacheWrite / 1_000_000
  }
  return cost
}
function fmtCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(5)}`
  if (usd < 0.01)  return `$${usd.toFixed(4)}`
  if (usd < 1)     return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

interface TokenUsageChartProps {
  project: ProjectAnalysis
  selectedSession?: SessionAnalysis
}

export function TokenUsageChart({ project, selectedSession }: TokenUsageChartProps) {

  // ── Per-session bar + derived data ───────────────────────────────────────
  const sortedSessions = [...project.sessions]
    .filter((s) => s.startTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const sessionData = sortedSessions
    .filter((s) => s.tokenUsage.totalTokens > 0)
    .slice(0, 20)
    .map((s) => ({
      name:     s.title.slice(0, 18),
      input:    s.tokenUsage.inputTokens,
      output:   s.tokenUsage.outputTokens,
      cacheRead: s.tokenUsage.cacheReadTokens,
    }))

  // ── Tool frequency (pie) ────────────────────────────────────────────────
  const toolData = project.topTools.slice(0, 8).map((t, i) => ({
    name: t.name, value: t.count, color: COLORS[i % COLORS.length],
  }))

  // ── Model distribution (pie) ────────────────────────────────────────────
  const modelData = Object.entries(project.models).map(([name, count], i) => ({
    name: name.replace("claude-", "").slice(0, 20), value: count, color: COLORS[i % COLORS.length],
  }))

  // ── Session token breakdown pie ─────────────────────────────────────────
  const focusData = selectedSession
    ? [
        { name: "Input",       value: selectedSession.tokenUsage.inputTokens,         color: "#3b82f6" },
        { name: "Output",      value: selectedSession.tokenUsage.outputTokens,        color: "#8b5cf6" },
        { name: "Cache Read",  value: selectedSession.tokenUsage.cacheReadTokens,     color: "#22c55e" },
        { name: "Cache Write", value: selectedSession.tokenUsage.cacheCreationTokens, color: "#f59e0b" },
      ].filter((d) => d.value > 0)
    : null

  // ── Agent token breakdown grouped bar ──────────────────────────────────
  const agentTokenData = selectedSession?.subagents.map((a) => ({
    name:       (a.type ?? a.agentId.slice(0, 8)).slice(0, 16),
    Input:      a.tokenUsage.inputTokens,
    Output:     a.tokenUsage.outputTokens,
    "Cache R":  a.tokenUsage.cacheReadTokens,
    "Cache W":  a.tokenUsage.cacheCreationTokens,
  })) ?? []

  // ── Agent duration + tool calls horizontal bar ──────────────────────────
  const agentDurationData = (selectedSession?.subagents ?? [])
    .filter((a) => a.startTime && a.endTime)
    .map((a) => ({
      name: (a.type ?? a.agentId.slice(0, 8)).slice(0, 16),
      "Duration (min)": +((new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60000).toFixed(1),
      "Tool Calls": a.toolCallCount,
    }))

  // ── Main + each agent total tokens ──────────────────────────────────────
  const agentTotalTokenData = (() => {
    if (!selectedSession || !selectedSession.subagents.length) return []
    const hasMainMessages = selectedSession.messages.some((m) => !m.isSidechain && m.role === "assistant")
    const subTotal   = selectedSession.subagents.reduce((n, a) => n + a.tokenUsage.totalTokens, 0)
    const subInput   = selectedSession.subagents.reduce((n, a) => n + a.tokenUsage.inputTokens, 0)
    const subOutput  = selectedSession.subagents.reduce((n, a) => n + a.tokenUsage.outputTokens, 0)
    const mainEntry = hasMainMessages
      ? [{ name: "Main", Tokens: Math.max(0, selectedSession.tokenUsage.totalTokens - subTotal),
           Input: Math.max(0, selectedSession.tokenUsage.inputTokens - subInput),
           Output: Math.max(0, selectedSession.tokenUsage.outputTokens - subOutput), color: "#8b5cf6" }]
      : []
    return [
      ...mainEntry,
      ...selectedSession.subagents.map((a, i) => ({
        name: (a.type ?? a.agentId.slice(0, 8)).slice(0, 16),
        Tokens: a.tokenUsage.totalTokens, Input: a.tokenUsage.inputTokens,
        Output: a.tokenUsage.outputTokens, color: COLORS[(i + (hasMainMessages ? 1 : 0)) % COLORS.length],
      })),
    ]
  })()

  // ── Context growth curve (cumulative tokens over assistant messages) ─────
  const contextGrowthData = (() => {
    if (!selectedSession) return []
    let cumulative = 0
    return selectedSession.messages
      .filter((m) => m.role === "assistant" && !m.isSidechain && m.usage)
      .map((m, i) => {
        const turn = (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0)
        cumulative += turn
        return { turn: i + 1, "Cumulative Tokens": cumulative, "This Turn": turn }
      })
  })()

  // ── Tool activity per message segment ───────────────────────────────────
  const toolActivityData = (() => {
    if (!selectedSession || !selectedSession.toolCalls.length) return []
    const msgs = selectedSession.messages.filter((m) => !m.isSidechain)
    const bucketSize = Math.max(1, Math.ceil(msgs.length / 20))
    const buckets: { seg: string; Tools: number }[] = []
    for (let i = 0; i < msgs.length; i += bucketSize) {
      const slice = msgs.slice(i, i + bucketSize)
      buckets.push({
        seg: `${i + 1}–${Math.min(i + bucketSize, msgs.length)}`,
        Tools: slice.reduce((n, m) => n + m.toolCalls.length, 0),
      })
    }
    return buckets
  })()

  // ── Cache hit rate per session ──────────────────────────────────────────
  const cacheHitData = sortedSessions
    .filter((s) => s.tokenUsage.inputTokens + s.tokenUsage.cacheReadTokens + s.tokenUsage.cacheCreationTokens > 0)
    .slice(0, 20)
    .map((s) => {
      const inputSide = s.tokenUsage.inputTokens + s.tokenUsage.cacheReadTokens + s.tokenUsage.cacheCreationTokens
      return {
        name: s.title.slice(0, 16),
        "Cache Hit %": Math.round((s.tokenUsage.cacheReadTokens / inputSide) * 100),
      }
    })

  // ── Output/Input ratio per session ──────────────────────────────────────
  const outputInputData = sortedSessions
    .filter((s) => s.tokenUsage.inputTokens > 0)
    .slice(0, 20)
    .map((s) => ({
      name: s.title.slice(0, 16),
      "Output/Input": +(s.tokenUsage.outputTokens / s.tokenUsage.inputTokens).toFixed(2),
    }))

  // ── Sessions by hour of day ─────────────────────────────────────────────
  const hourData = (() => {
    const counts = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2,"0")}:00`, Sessions: 0 }))
    for (const s of project.sessions) {
      if (s.startTime) {
        const h = new Date(s.startTime).getHours()
        counts[h].Sessions++
      }
    }
    return counts
  })()

  // ── Session duration histogram ──────────────────────────────────────────
  const durationBuckets = [
    { label: "<5 min",   min: 0,          max: 5 * 60000 },
    { label: "5–15 min", min: 5 * 60000,  max: 15 * 60000 },
    { label: "15–30 min",min: 15 * 60000, max: 30 * 60000 },
    { label: "30–60 min",min: 30 * 60000, max: 60 * 60000 },
    { label: "1–2 hr",   min: 60 * 60000, max: 120 * 60000 },
    { label: ">2 hr",    min: 120 * 60000, max: Infinity },
  ]
  const durationHistData = durationBuckets.map((b) => ({
    label: b.label,
    Sessions: project.sessions.filter((s) => s.duration >= b.min && s.duration < b.max).length,
  }))

  // ── Sessions by git branch ──────────────────────────────────────────────
  const branchData = (() => {
    const counts: Record<string, number> = {}
    for (const s of project.sessions) {
      const b = s.gitBranch || "(none)"
      counts[b] = (counts[b] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([branch, Sessions]) => ({ branch: branch.slice(0, 20), Sessions }))
  })()

  // ── Entrypoint distribution ─────────────────────────────────────────────
  const entrypointData = Object.entries(project.entrypoints)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count], i) => ({ name: name.slice(0, 20), Sessions: count, color: COLORS[i % COLORS.length] }))

  // ── Thinking vs normal sessions ────────────────────────────────────────
  const thinkingCount = project.sessions.filter((s) => s.hasThinking).length
  const thinkingData = [
    { name: "Extended Thinking", value: thinkingCount, color: "#8b5cf6" },
    { name: "Standard", value: project.totalSessions - thinkingCount, color: "#3b82f6" },
  ].filter((d) => d.value > 0)

  // ── Cost estimation (per-model, per-message) ────────────────────────────
  const sessionCosts = project.sessions.map((s) => ({ id: s.sessionId, cost: estimateSessionCost(s) }))
  const totalCost    = sessionCosts.reduce((n, s) => n + s.cost, 0)
  const sessionCost  = selectedSession ? estimateSessionCost(selectedSession) : null
  const costPerSessionData = sortedSessions
    .slice(0, 20)
    .map((s) => ({ name: s.title.slice(0, 16), "Cost ($)": +estimateSessionCost(s).toFixed(5) }))

  // Cache savings = (cacheRead tokens × difference between input price and cache-read price)
  // We approximate using sonnet pricing for the savings figure since we don't split cache reads by model
  const cacheSavings = project.sessions.reduce((total, session) => {
    const msgs = [...session.messages, ...session.subagents.flatMap((a) => a.messages)]
      .filter((m) => m.role === "assistant" && m.usage)
    return total + msgs.reduce((n, m) => {
      const p = modelPricing(m.model)
      return n + (m.usage?.cache_read_input_tokens ?? 0) * (p.input - p.cacheRead) / 1_000_000
    }, 0)
  }, 0)

  // ── Sessions over time (area) ────────────────────────────────────────────
  const sessionsOverTime = sortedSessions.slice(0, 30).map((s, i) => ({
    idx: i + 1, Tokens: s.tokenUsage.totalTokens, Tools: s.toolCalls.length,
  }))

  const singleSession = sessionData.length === 1 ? project.sessions[0] : null
  const hasAgents     = (selectedSession?.subagents.length ?? 0) > 0
  const isMulti       = project.sessions.length > 1

  return (
    <div className="flex flex-col gap-4">

      {/* ── Cost summary cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg p-2 bg-emerald-500/10"><DollarSign className="h-4 w-4 text-emerald-400" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Est. Total Cost</p>
              <p className="text-lg font-bold text-foreground">{fmtCost(totalCost)}</p>
            </div>
          </CardContent>
        </Card>
        {sessionCost !== null && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg p-2 bg-emerald-500/10"><DollarSign className="h-4 w-4 text-emerald-400" /></div>
              <div>
                <p className="text-xs text-muted-foreground">This Session</p>
                <p className="text-lg font-bold text-foreground">{fmtCost(sessionCost)}</p>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg p-2 bg-green-500/10"><TrendingUp className="h-4 w-4 text-green-400" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Cache Savings</p>
              <p className="text-lg font-bold text-foreground">{fmtCost(cacheSavings)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg p-2 bg-cyan-500/10"><Activity className="h-4 w-4 text-cyan-400" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Cost/Session</p>
              <p className="text-lg font-bold text-foreground">
                {project.totalSessions > 0 ? fmtCost(totalCost / project.totalSessions) : "$0"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      <p className="text-[10px] text-muted-foreground/50 -mt-2 px-1">
        Cost calculated per model — Opus $15/$75 · Sonnet $3/$15 · Haiku $0.80/$4 per M input/output tokens. Estimates only.
      </p>

      {/* ── Single-session stat cards ──────────────────────────────────────── */}
      {singleSession && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { icon: MessageSquare, label: "Total Messages", value: String(singleSession.messageCount.total), color: "text-blue-400 bg-blue-500/10" },
            { icon: Wrench,        label: "Tool Calls",     value: String(singleSession.toolCalls.length),    color: "text-green-400 bg-green-500/10" },
            { icon: Bot,           label: "Subagents",      value: String(singleSession.subagents.length),    color: "text-amber-400 bg-amber-500/10" },
            { icon: Zap,           label: "Output Tokens",  value: formatNumber(singleSession.tokenUsage.outputTokens), color: "text-violet-400 bg-violet-500/10" },
            { icon: Zap,           label: "Cache Read",     value: formatNumber(singleSession.tokenUsage.cacheReadTokens), color: "text-cyan-400 bg-cyan-500/10" },
            { icon: Clock,         label: "Duration",       value: formatDuration(singleSession.duration),    color: "text-pink-400 bg-pink-500/10" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`rounded-lg p-2 ${s.color.split(" ")[1]}`}>
                  <s.icon className={`h-4 w-4 ${s.color.split(" ")[0]}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold text-foreground">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {singleSession?.hasThinking && (
        <div className="flex items-center gap-2 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
          <Brain className="h-3.5 w-3.5" />
          This session used extended thinking (internal reasoning is visible in the Conversation tab)
        </div>
      )}

      {/* ── Session Timeline (Git Graph) ───────────────────────────────────── */}
      {selectedSession && hasAgents && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <GitBranch className="h-3.5 w-3.5" /> Session Timeline
          </div>
          <SessionGitGraph session={selectedSession} />
        </div>
      )}

      {/* ── Context growth + Tool activity (per session) ──────────────────── */}
      {selectedSession && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {contextGrowthData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-cyan-400" /> Context Growth
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={contextGrowthData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradCtx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis dataKey="turn" tick={TICK} label={{ value: "Assistant turn", position: "insideBottom", offset: -2, fill: "hsl(215 20% 55%)", fontSize: 10 }} />
                    <YAxis tick={TICK} tickFormatter={formatNumber} />
                    <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} formatter={(v) => formatNumber(Number(v))} />
                    <Area type="monotone" dataKey="Cumulative Tokens" stroke="#06b6d4" fill="url(#gradCtx)" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {toolActivityData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-green-400" /> Tool Activity by Message
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={toolActivityData} margin={{ top: 4, right: 16, left: 0, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis dataKey="seg" tick={TICK} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tick={TICK} allowDecimals={false} />
                    <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                    <Bar dataKey="Tools" fill="#22c55e" radius={[3,3,0,0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Agent token breakdown ─────────────────────────────────────────── */}
      {hasAgents && agentTokenData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-amber-400" /> Agent Token Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={agentTokenData} margin={{ top: 4, right: 16, left: 0, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="name" tick={TICK} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={TICK} tickFormatter={formatNumber} />
                <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} formatter={(v) => formatNumber(Number(v))} />
                <Legend wrapperStyle={{ ...LEGEND, paddingTop: 8 }} iconSize={8} />
                <Bar dataKey="Input"   fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={32} />
                <Bar dataKey="Output"  fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={32} />
                <Bar dataKey="Cache R" fill="#22c55e" radius={[2,2,0,0]} maxBarSize={32} />
                <Bar dataKey="Cache W" fill="#f59e0b" radius={[2,2,0,0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Agent duration + tool calls ───────────────────────────────────── */}
      {hasAgents && agentDurationData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-pink-400" /> Agent Duration (minutes)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(160, agentDurationData.length * 36)}>
                <BarChart data={agentDurationData} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={TICK} />
                  <YAxis type="category" dataKey="name" tick={TICK} width={80} />
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} formatter={(v) => [`${v} min`, "Duration"]} />
                  <Bar dataKey="Duration (min)" fill="#ec4899" radius={[0,3,3,0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-green-400" /> Agent Tool Calls
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(160, agentDurationData.length * 36)}>
                <BarChart data={agentDurationData} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={TICK} />
                  <YAxis type="category" dataKey="name" tick={TICK} width={80} />
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                  <Bar dataKey="Tool Calls" fill="#22c55e" radius={[0,3,3,0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Main + each agent total tokens ────────────────────────────────── */}
      {agentTotalTokenData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-violet-400" /> Total Tokens — Main + Each Agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(160, agentTotalTokenData.length * 36)}>
              <BarChart data={agentTotalTokenData} layout="vertical" margin={{ top: 0, right: 64, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={TICK} tickFormatter={formatNumber} />
                <YAxis type="category" dataKey="name" tick={TICK} width={88} />
                <Tooltip
                  contentStyle={CHART_STYLE} cursor={CURSOR}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as typeof agentTotalTokenData[0]
                    return (
                      <div style={CHART_STYLE} className="px-3 py-2 space-y-1">
                        <p className="font-semibold text-foreground mb-1">{d.name}</p>
                        <p className="text-muted-foreground">Total &nbsp;<span className="text-foreground font-mono">{formatNumber(d.Tokens)}</span></p>
                        <p className="text-muted-foreground">Input &nbsp;<span className="text-foreground font-mono">{formatNumber(d.Input)}</span></p>
                        <p className="text-muted-foreground">Output <span className="text-foreground font-mono">{formatNumber(d.Output)}</span></p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="Tokens" radius={[0,3,3,0]} maxBarSize={20}>
                  {agentTotalTokenData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Multi-session: cost per session + cache hit rate ──────────────── */}
      {isMulti && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-3.5 w-3.5 text-emerald-400" /> Estimated Cost per Session
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={costPerSessionData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="name" tick={TICK} angle={-35} textAnchor="end" />
                  <YAxis tick={TICK} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} formatter={(v) => [`$${v}`, "Cost"]} />
                  <Bar dataKey="Cost ($)" fill="#10b981" radius={[3,3,0,0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-green-400" /> Cache Hit Rate per Session
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cacheHitData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="name" tick={TICK} angle={-35} textAnchor="end" />
                  <YAxis tick={TICK} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} formatter={(v) => [`${v}%`, "Cache Hit"]} />
                  <Bar dataKey="Cache Hit %" fill="#22c55e" radius={[3,3,0,0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Output/Input ratio per session ────────────────────────────────── */}
      {isMulti && outputInputData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-violet-400" /> Output / Input Ratio per Session
              <span className="ml-auto text-xs font-normal text-muted-foreground">higher = more generation per prompt</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={outputInputData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="name" tick={TICK} angle={-35} textAnchor="end" />
                <YAxis tick={TICK} />
                <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                <Bar dataKey="Output/Input" fill="#a78bfa" radius={[3,3,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Tokens per session ────────────────────────────────────────────── */}
      {isMulti && sessionData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart2 className="h-3.5 w-3.5" /> Tokens per Session
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sessionData} margin={{ top: 0, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="name" tick={TICK} angle={-35} textAnchor="end" />
                <YAxis tick={TICK} tickFormatter={formatNumber} />
                <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} formatter={(v) => formatNumber(Number(v))} />
                <Legend wrapperStyle={LEGEND} iconSize={8} />
                <Bar dataKey="input"    name="Input"      stackId="a" fill="#3b82f6" />
                <Bar dataKey="output"   name="Output"     stackId="a" fill="#8b5cf6" />
                <Bar dataKey="cacheRead" name="Cache Read" stackId="a" fill="#22c55e" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Activity over sessions (area) ─────────────────────────────────── */}
      {sessionsOverTime.length > 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-cyan-400" /> Activity Over Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={sessionsOverTime} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradTools" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="idx" tick={TICK} label={{ value: "Session #", position: "insideBottom", offset: -2, fill: "hsl(215 20% 55%)", fontSize: 10 }} />
                <YAxis tick={TICK} tickFormatter={formatNumber} />
                <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} formatter={(v) => formatNumber(Number(v))} />
                <Legend wrapperStyle={LEGEND} iconSize={8} />
                <Area type="monotone" dataKey="Tokens" stroke="#8b5cf6" fill="url(#gradTokens)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="Tools"  stroke="#22c55e" fill="url(#gradTools)"  strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Sessions by hour of day + duration histogram ───────────────────── */}
      {isMulti && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-blue-400" /> Sessions by Hour of Day
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hourData} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="hour" tick={{ ...TICK, fontSize: 8 }} interval={3} angle={-45} textAnchor="end" />
                  <YAxis tick={TICK} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                  <Bar dataKey="Sessions" fill="#3b82f6" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-pink-400" /> Session Duration Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={durationHistData} margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="label" tick={TICK} />
                  <YAxis tick={TICK} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                  <Bar dataKey="Sessions" fill="#ec4899" radius={[3,3,0,0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Git branch distribution ────────────────────────────────────────── */}
      {isMulti && branchData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5 text-amber-400" /> Sessions by Git Branch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(160, branchData.length * 32)}>
              <BarChart data={branchData} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={TICK} allowDecimals={false} />
                <YAxis type="category" dataKey="branch" tick={TICK} width={120} />
                <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                <Bar dataKey="Sessions" fill="#f59e0b" radius={[0,3,3,0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Tool pie + session token mix + entrypoints + thinking ─────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {toolData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-3.5 w-3.5" /> Top Tools</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={toolData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                    {toolData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                  <Legend wrapperStyle={LEGEND} iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {focusData && focusData.length > 0 ? (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="h-3.5 w-3.5" /> Session Token Mix</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={focusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                    {focusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} formatter={(v) => formatNumber(Number(v))} />
                  <Legend wrapperStyle={LEGEND} iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : modelData.length > 0 ? (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-3.5 w-3.5" /> Model Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={modelData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                    {modelData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                  <Legend wrapperStyle={LEGEND} iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}

        {entrypointData.length > 1 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart2 className="h-3.5 w-3.5 text-blue-400" /> Entrypoint Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={entrypointData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="Sessions">
                    {entrypointData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                  <Legend wrapperStyle={LEGEND} iconSize={8} formatter={(v) => v.slice(0, 20)} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {thinkingData.length > 1 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="h-3.5 w-3.5 text-violet-400" /> Extended Thinking Usage</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={thinkingData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                    {thinkingData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_STYLE} cursor={CURSOR} />
                  <Legend wrapperStyle={LEGEND} iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

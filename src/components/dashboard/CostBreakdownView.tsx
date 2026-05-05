import { Fragment, useState, useMemo } from "react"
import {
  DollarSign, Edit2, RotateCcw, ChevronDown, ChevronRight,
  Zap, Bot, TrendingUp, Info, AlertTriangle, Globe,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatNumber, dedupeAssistantForTokens } from "@/utils/logParser"
import type { ProjectAnalysis, SessionAnalysis, ParsedMessage } from "@/types/logs"

// ── Pricing types ─────────────────────────────────────────────────────────────

interface Pricing {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

type ModelKey = "opus" | "sonnet" | "haiku" | "unknown"

type ModelPricing = Record<ModelKey, Pricing>

// USD per 1M tokens — refreshed for Claude 4.x family (Jan 2026)
const DEFAULT_PRICING: ModelPricing = {
  opus:    { input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
  sonnet:  { input:  3.00, output: 15.00, cacheRead: 0.30,  cacheWrite:  3.75 },
  haiku:   { input:  1.00, output:  5.00, cacheRead: 0.10,  cacheWrite:  1.25 },
  unknown: { input:  0.00, output:  0.00, cacheRead: 0.00,  cacheWrite:  0.00 },
}

// Web search: $10 per 1k requests. Web fetch: included in token cost.
const WEB_SEARCH_PER_REQUEST = 10 / 1000

const MODEL_META: Record<ModelKey, { label: string; color: string; bg: string }> = {
  opus:    { label: "Claude Opus",   color: "text-violet-400", bg: "bg-violet-500/10" },
  sonnet:  { label: "Claude Sonnet", color: "text-blue-400",   bg: "bg-blue-500/10"   },
  haiku:   { label: "Claude Haiku",  color: "text-green-400",  bg: "bg-green-500/10"  },
  unknown: { label: "Unknown Model", color: "text-rose-400",   bg: "bg-rose-500/10"   },
}

// Editable rows in the pricing table (omit "unknown" from the editor)
const EDITABLE_MODELS: Exclude<ModelKey, "unknown">[] = ["opus", "sonnet", "haiku"]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getModelKey(model?: string): ModelKey {
  const m = (model ?? "").toLowerCase()
  if (m.includes("opus"))   return "opus"
  if (m.includes("sonnet")) return "sonnet"
  if (m.includes("haiku"))  return "haiku"
  return "unknown"
}

function fmtCost(usd: number): string {
  if (usd === 0)       return "$0.00"
  if (usd < 0.0001)   return `$${usd.toFixed(6)}`
  if (usd < 0.001)    return `$${usd.toFixed(5)}`
  if (usd < 0.01)     return `$${usd.toFixed(4)}`
  if (usd < 1)        return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

interface ModelCostEntry {
  input: number; output: number; cacheRead: number; cacheWrite: number; total: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

function calcMsgCost(msg: ParsedMessage, pricing: ModelPricing): number {
  if (msg.role !== "assistant" || !msg.usage) return 0
  const p = pricing[getModelKey(msg.model)]
  const webSearch = (msg.usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_PER_REQUEST
  return (
    (msg.usage.input_tokens                 ?? 0) * p.input     / 1_000_000 +
    (msg.usage.output_tokens                ?? 0) * p.output    / 1_000_000 +
    (msg.usage.cache_read_input_tokens      ?? 0) * p.cacheRead  / 1_000_000 +
    (msg.usage.cache_creation_input_tokens  ?? 0) * p.cacheWrite / 1_000_000 +
    webSearch
  )
}

function calcSessionBreakdown(session: SessionAnalysis, pricing: ModelPricing) {
  // Main session messages are already in session.messages (non-sidechain canonical).
  // Subagent messages live in session.subagents — keep them, but each list must be
  // deduped by message.id so we don't sum the same streamed response multiple times.
  const dedupedMain = dedupeAssistantForTokens(session.messages.filter((m) => !m.isSidechain))
  const dedupedAgents = session.subagents.flatMap((a) =>
    dedupeAssistantForTokens(a.messages)
  )
  const allMessages = [...dedupedMain, ...dedupedAgents]

  const modelCosts: Partial<Record<ModelKey, ModelCostEntry>> = {}
  let total = 0
  let webSearchRequests = 0
  let webSearchCost = 0

  for (const msg of allMessages) {
    if (!msg.usage) continue
    const key = getModelKey(msg.model)
    const p   = pricing[key]
    const inp = (msg.usage.input_tokens                 ?? 0) * p.input     / 1_000_000
    const out = (msg.usage.output_tokens                ?? 0) * p.output    / 1_000_000
    const cr  = (msg.usage.cache_read_input_tokens      ?? 0) * p.cacheRead  / 1_000_000
    const cw  = (msg.usage.cache_creation_input_tokens  ?? 0) * p.cacheWrite / 1_000_000
    const mt  = inp + out + cr + cw

    if (!modelCosts[key]) {
      modelCosts[key] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
    }
    const mc = modelCosts[key]!
    mc.input     += inp;  mc.output    += out
    mc.cacheRead += cr;   mc.cacheWrite += cw;  mc.total += mt
    mc.tokens.input     += (msg.usage.input_tokens                ?? 0)
    mc.tokens.output    += (msg.usage.output_tokens               ?? 0)
    mc.tokens.cacheRead += (msg.usage.cache_read_input_tokens     ?? 0)
    mc.tokens.cacheWrite += (msg.usage.cache_creation_input_tokens ?? 0)

    const ws = msg.usage.server_tool_use?.web_search_requests ?? 0
    webSearchRequests += ws
    webSearchCost     += ws * WEB_SEARCH_PER_REQUEST

    total += mt
  }
  total += webSearchCost

  const agentCosts = session.subagents.map((a) => {
    const dedup = dedupeAssistantForTokens(a.messages)
    return {
      agentId:     a.agentId,
      type:        a.type,
      description: a.description,
      cost:        dedup.reduce((n, m) => n + calcMsgCost(m, pricing), 0),
      tokenUsage:  a.tokenUsage,
    }
  }).sort((a, b) => b.cost - a.cost)

  return { total, modelCosts, agentCosts, webSearchRequests, webSearchCost }
}

// ── Editable price input ──────────────────────────────────────────────────────

function PriceInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState("")

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        step="0.01"
        min="0"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          const n = parseFloat(raw)
          if (!isNaN(n) && n >= 0) onChange(n)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          if (e.key === "Escape") setEditing(false)
        }}
        className="w-full text-right bg-secondary border border-primary/50 rounded px-1.5 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
    )
  }

  return (
    <button
      onClick={() => { setRaw(String(value)); setEditing(true) }}
      title="Click to edit"
      className="group w-full text-right text-xs font-mono text-foreground hover:text-primary transition-colors flex items-center justify-end gap-1"
    >
      <Edit2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
      ${value.toFixed(2)}<span className="text-muted-foreground/50 text-[10px] ml-0.5">/1M</span>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface CostBreakdownViewProps {
  project: ProjectAnalysis
  selectedSession?: SessionAnalysis
}

export function CostBreakdownView({ project, selectedSession }: CostBreakdownViewProps) {
  const [pricing, setPricing]               = useState<ModelPricing>(DEFAULT_PRICING)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  const isModified = JSON.stringify(pricing) !== JSON.stringify(DEFAULT_PRICING)

  const updatePrice = (model: ModelKey, field: keyof Pricing, value: number) => {
    setPricing((prev) => ({ ...prev, [model]: { ...prev[model], [field]: value } }))
  }

  const sessionBreakdowns = useMemo(() =>
    project.sessions
      .map((s) => ({ session: s, ...calcSessionBreakdown(s, pricing) }))
      .sort((a, b) => b.total - a.total),
    [project.sessions, pricing]
  )

  const totalCost = sessionBreakdowns.reduce((n, s) => n + s.total, 0)

  const cacheSavings = useMemo(() =>
    project.sessions.reduce((sum, session) => {
      const msgs = dedupeAssistantForTokens([
        ...session.messages.filter((m) => !m.isSidechain),
        ...session.subagents.flatMap((a) => a.messages),
      ])
      return sum + msgs.reduce((n, m) => {
        const p = pricing[getModelKey(m.model)]
        return n + (m.usage?.cache_read_input_tokens ?? 0) * (p.input - p.cacheRead) / 1_000_000
      }, 0)
    }, 0),
    [project.sessions, pricing]
  )

  // Surface unknown-model usage so users know cost is incomplete
  const unknownModelTokens = useMemo(() => {
    let n = 0
    for (const session of project.sessions) {
      const msgs = dedupeAssistantForTokens([
        ...session.messages.filter((m) => !m.isSidechain),
        ...session.subagents.flatMap((a) => a.messages),
      ])
      for (const m of msgs) {
        if (getModelKey(m.model) === "unknown" && m.usage) {
          n += (m.usage.input_tokens ?? 0)
             + (m.usage.output_tokens ?? 0)
             + (m.usage.cache_creation_input_tokens ?? 0)
             + (m.usage.cache_read_input_tokens ?? 0)
        }
      }
    }
    return n
  }, [project.sessions])

  const totalWebSearchRequests = sessionBreakdowns.reduce((n, s) => n + s.webSearchRequests, 0)

  const selectedBreakdown = selectedSession
    ? sessionBreakdowns.find((b) => b.session.sessionId === selectedSession.sessionId)
    : null

  const toggleSession = (id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const PRICE_FIELDS: Array<{ key: keyof Pricing; label: string }> = [
    { key: "input",      label: "Input" },
    { key: "output",     label: "Output" },
    { key: "cacheRead",  label: "Cache Read" },
    { key: "cacheWrite", label: "Cache Write" },
  ]

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 pb-8">

        {/* ── Pricing Editor ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Edit2 className="h-3.5 w-3.5 text-primary" />
              Pricing — per 1M tokens (USD)
              <span className="ml-1 flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
                <Info className="h-3 w-3" /> Click any value to edit
              </span>
              {isModified && (
                <button
                  onClick={() => setPricing(DEFAULT_PRICING)}
                  className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className="h-3 w-3" /> Reset defaults
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pl-3 pr-4 font-medium text-muted-foreground w-40">Model</th>
                    {PRICE_FIELDS.map((f) => (
                      <th key={f.key} className="text-right py-2 px-4 font-medium text-muted-foreground min-w-[100px]">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EDITABLE_MODELS.map((key) => (
                    <tr key={key} className="border-b border-border/40 last:border-0">
                      <td className="py-3 pl-3 pr-4">
                        <div className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold ${MODEL_META[key].bg} ${MODEL_META[key].color}`}>
                          {MODEL_META[key].label}
                        </div>
                      </td>
                      {PRICE_FIELDS.map((f) => (
                        <td key={f.key} className="py-3 px-4 text-right">
                          <PriceInput
                            value={pricing[key][f.key]}
                            onChange={(v) => updatePrice(key, f.key, v)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unknownModelTokens > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-rose-300 font-medium">Unknown model detected</p>
                  <p className="text-muted-foreground">
                    {formatNumber(unknownModelTokens)} tokens used a model that doesn't match Opus / Sonnet / Haiku — these are priced at $0 in the breakdown below.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Summary cards ────────────────────────────────────────────── */}
        <div className={`grid grid-cols-2 ${totalWebSearchRequests > 0 ? "md:grid-cols-5" : "md:grid-cols-4"} gap-3`}>
          {[
            { label: "Total Estimated Cost", value: fmtCost(totalCost),       icon: DollarSign, color: "emerald" },
            { label: "Cache Savings",         value: fmtCost(cacheSavings),    icon: TrendingUp, color: "green"   },
            { label: "Avg Cost / Session",    value: project.totalSessions > 0 ? fmtCost(totalCost / project.totalSessions) : "$0", icon: Zap, color: "cyan" },
            { label: "Most Expensive",        value: sessionBreakdowns[0] ? fmtCost(sessionBreakdowns[0].total) : "$0", icon: Bot, color: "violet" },
            ...(totalWebSearchRequests > 0
              ? [{
                  label: "Web Search",
                  value: `${formatNumber(totalWebSearchRequests)} · ${fmtCost(totalWebSearchRequests * WEB_SEARCH_PER_REQUEST)}`,
                  icon: Globe,
                  color: "sky",
                }]
              : []),
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`rounded-lg p-2 bg-${c.color}-500/10`}>
                  <c.icon className={`h-4 w-4 text-${c.color}-400`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="text-lg font-bold text-foreground">{c.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Selected session detail ──────────────────────────────────── */}
        {selectedBreakdown && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-violet-400" />
                <span className="truncate">{selectedBreakdown.session.title}</span>
                <span className="ml-auto shrink-0 text-sm font-bold text-emerald-400">
                  {fmtCost(selectedBreakdown.total)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">

              {/* By model */}
              {Object.keys(selectedBreakdown.modelCosts).length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Cost by Model</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-1.5 pr-4 font-medium">Model</th>
                        <th className="text-right py-1.5 px-3 font-medium min-w-[90px]">Input</th>
                        <th className="text-right py-1.5 px-3 font-medium min-w-[90px]">Output</th>
                        <th className="text-right py-1.5 px-3 font-medium min-w-[90px]">Cache Read</th>
                        <th className="text-right py-1.5 px-3 font-medium min-w-[90px]">Cache Write</th>
                        <th className="text-right py-1.5 pl-3 font-medium min-w-[80px]">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.entries(selectedBreakdown.modelCosts) as [ModelKey, ModelCostEntry][]).map(([model, c]) => {
                        const totalTok = c.tokens.input + c.tokens.output + c.tokens.cacheRead + c.tokens.cacheWrite
                        return (
                          <tr key={model} className="border-b border-border/30 last:border-0">
                            <td className="py-2.5 pr-4">
                              <span className={`font-semibold ${MODEL_META[model].color}`}>
                                {MODEL_META[model].label}
                              </span>
                              <span className="ml-2 text-[10px] text-muted-foreground/50 font-mono">
                                {formatNumber(totalTok)} tok
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <p className="font-mono text-foreground">{fmtCost(c.input)}</p>
                              <p className="text-[10px] font-mono text-muted-foreground/60">{formatNumber(c.tokens.input)} tok</p>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <p className="font-mono text-foreground">{fmtCost(c.output)}</p>
                              <p className="text-[10px] font-mono text-muted-foreground/60">{formatNumber(c.tokens.output)} tok</p>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <p className="font-mono text-green-400/80">{fmtCost(c.cacheRead)}</p>
                              <p className="text-[10px] font-mono text-muted-foreground/60">{formatNumber(c.tokens.cacheRead)} tok</p>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <p className="font-mono text-amber-400/80">{fmtCost(c.cacheWrite)}</p>
                              <p className="text-[10px] font-mono text-muted-foreground/60">{formatNumber(c.tokens.cacheWrite)} tok</p>
                            </td>
                            <td className="py-2.5 pl-3 text-right">
                              <p className="font-mono font-bold text-foreground">{fmtCost(c.total)}</p>
                              <p className="text-[10px] font-mono text-muted-foreground/60">{formatNumber(totalTok)} tok</p>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* By agent */}
              {selectedBreakdown.agentCosts.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Cost by Agent</p>
                  <div className="space-y-0.5">
                    {selectedBreakdown.agentCosts.map((a) => {
                      const sharePct = selectedBreakdown.total > 0
                        ? (a.cost / selectedBreakdown.total) * 100
                        : 0
                      return (
                        <div key={a.agentId} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                          <div className="w-24 shrink-0">
                            <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${MODEL_META.haiku.bg} ${MODEL_META.haiku.color}`}>
                              {(a.type ?? a.agentId.slice(0, 10)).slice(0, 14)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            {a.description && (
                              <p className="text-[10px] text-muted-foreground/70 truncate">{a.description}</p>
                            )}
                            <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full rounded-full bg-amber-500" style={{ width: `${sharePct}%` }} />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-mono font-semibold text-foreground">{fmtCost(a.cost)}</p>
                            <p className="text-[10px] text-muted-foreground/60">{sharePct.toFixed(0)}%</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── All sessions table ───────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
              All Sessions
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                Click a row to expand model & agent details
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2.5 px-4 font-medium">Session</th>
                  <th className="text-right py-2.5 px-3 font-medium">Models</th>
                  <th className="text-right py-2.5 px-3 font-medium">Tokens</th>
                  <th className="text-right py-2.5 px-3 font-medium">Agents</th>
                  <th className="text-right py-2.5 px-4 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {sessionBreakdowns.map(({ session, total, modelCosts, agentCosts }) => {
                  const isExpanded = expandedSessions.has(session.sessionId)
                  const modelKeys  = Object.keys(modelCosts) as ModelKey[]
                  const hasDetails = agentCosts.length > 0 || modelKeys.length > 0

                  return (
                    <Fragment key={session.sessionId}>
                      <tr
                        onClick={() => hasDetails && toggleSession(session.sessionId)}
                        className={`border-b border-border/40 transition-colors ${hasDetails ? "cursor-pointer hover:bg-secondary/30" : ""}`}
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            {hasDetails
                              ? isExpanded
                                ? <ChevronDown  className="h-3 w-3 text-muted-foreground shrink-0" />
                                : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                              : <span className="w-3 shrink-0" />
                            }
                            <span className="text-foreground truncate max-w-[220px]" title={session.title}>
                              {session.title}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {modelKeys.map((m) => (
                              <span key={m} className={`text-[10px] font-mono px-1 py-0.5 rounded ${MODEL_META[m].bg} ${MODEL_META[m].color}`}>
                                {m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                          {formatNumber(session.tokenUsage.totalTokens)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground">
                          {session.subagents.length > 0 ? session.subagents.length : "—"}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-foreground">
                          {fmtCost(total)}
                        </td>
                      </tr>

                      {isExpanded && (
                        <>
                          {/* Model rows */}
                          {modelKeys.map((m) => {
                            const mc = modelCosts[m]!
                            const totalTok = mc.tokens.input + mc.tokens.output + mc.tokens.cacheRead + mc.tokens.cacheWrite
                            return (
                              <tr key={`${session.sessionId}-m-${m}`} className="bg-secondary/20 border-b border-border/20">
                                <td className="py-1.5 pl-10 pr-4 text-muted-foreground" colSpan={1}>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-mono ${MODEL_META[m].color}`}>{MODEL_META[m].label}</span>
                                    <span className="text-muted-foreground/50 text-[10px]">
                                      in:{fmtCost(mc.input)} · out:{fmtCost(mc.output)} · cr:{fmtCost(mc.cacheRead)} · cw:{fmtCost(mc.cacheWrite)}
                                    </span>
                                  </div>
                                </td>
                                <td colSpan={2} />
                                <td className="py-1.5 px-3 text-right font-mono text-[10px] text-muted-foreground/70">
                                  {formatNumber(totalTok)} tok
                                </td>
                                <td className="py-1.5 px-4 text-right font-mono text-[11px] text-muted-foreground">{fmtCost(mc.total)}</td>
                              </tr>
                            )
                          })}

                          {/* Agent rows */}
                          {agentCosts.map((a) => (
                            <tr key={`${session.sessionId}-a-${a.agentId}`} className="bg-secondary/10 border-b border-border/10">
                              <td className="py-1.5 pl-10 pr-4" colSpan={1}>
                                <div className="flex items-center gap-2">
                                  <Bot className="h-3 w-3 text-amber-400 shrink-0" />
                                  <span className="font-mono text-[10px] text-amber-400">
                                    {(a.type ?? a.agentId.slice(0, 12)).slice(0, 16)}
                                  </span>
                                  {a.description && (
                                    <span className="text-muted-foreground/50 text-[10px] truncate max-w-[200px]">
                                      {a.description}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td colSpan={3} />
                              <td className="py-1.5 px-4 text-right font-mono text-[11px] text-amber-400/80">{fmtCost(a.cost)}</td>
                            </tr>
                          ))}
                        </>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-secondary/30">
                  <td className="py-3 px-4 font-semibold text-foreground text-sm" colSpan={4}>Total</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400 text-sm">{fmtCost(totalCost)}</td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

      </div>
    </ScrollArea>
  )
}

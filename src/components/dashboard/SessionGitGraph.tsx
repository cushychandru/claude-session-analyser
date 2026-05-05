import { useMemo, useRef, useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { GitBranch } from "lucide-react"
import { formatDuration, formatNumber } from "@/utils/logParser"
import type { SessionAnalysis, SubagentInfo } from "@/types/logs"

// ── Layout constants ──────────────────────────────────────────────────────────
const H_PAD   = 16
const V_PAD   = 18
const V_PAD_B = 30
const LANE_H  = 44
const DOT_R   = 4.5
const TICK_H  = 4
const HIT_R   = 10   // invisible hit-area radius for tooltip

const COLORS = [
  "#818cf8",
  "#fb923c",
  "#34d399",
  "#60a5fa",
  "#f472b6",
  "#a78bfa",
  "#facc15",
  "#2dd4bf",
  "#f87171",
]

function hhmm(ts: string) {
  if (!ts) return ""
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts))
  } catch { return "" }
}

interface TooltipData {
  x: number
  y: number
  agent: SubagentInfo
  color: string
}

export function SessionGitGraph({ session }: { session: SessionAnalysis }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(760)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContainerW(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const chartW = Math.max(320, containerW - H_PAD * 2)
  const svgW   = containerW

  const { tMin, tMax, svgH } = useMemo(() => {
    const tMin = new Date(session.startTime || 0).getTime()
    const tMax = new Date(session.endTime   || Date.now()).getTime()
    const numLanes = session.subagents.length + 1
    return { tMin, tMax, svgH: V_PAD + numLanes * LANE_H + V_PAD_B }
  }, [session])

  const tRange = Math.max(tMax - tMin, 1)
  const tx = (ts: string) => H_PAD + ((new Date(ts || 0).getTime() - tMin) / tRange) * chartW
  const ly = (lane: number) => V_PAD + lane * LANE_H + LANE_H / 2

  const mainColor = COLORS[0]
  const mainY  = ly(0)
  const x0     = H_PAD
  const x1end  = H_PAD + chartW

  const showTooltip = useCallback((e: React.MouseEvent<SVGElement>, agent: SubagentInfo, color: string) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, agent, color })
  }, [])

  const hideTooltip = useCallback(() => setTooltip(null), [])

  const lanes = [
    { label: "Main", color: mainColor },
    ...session.subagents.map((a, i) => ({
      label: a.type ?? `agent-${a.agentId.slice(0, 6)}`,
      color: COLORS[(i + 1) % COLORS.length],
    })),
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <GitBranch className="h-3.5 w-3.5" /> Session Timeline
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {session.subagents.length} agent{session.subagents.length !== 1 ? "s" : ""}
          </span>
        </CardTitle>
      </CardHeader>

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-t border-border bg-muted/20">
        {lanes.map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1.5 text-xs" style={{ color }}>
            <svg width={10} height={10} className="shrink-0">
              <circle cx={5} cy={5} r={4} fill={color} />
            </svg>
            {label}
          </span>
        ))}
      </div>

      <CardContent className="p-0">
        <div ref={containerRef} className="w-full relative" onMouseLeave={hideTooltip}>
          <svg
            width={svgW}
            height={svgH}
            className="block select-none"
            style={{ fontFamily: "ui-monospace,monospace" }}
          >
            {/* ── Time axis ruler ───────────────────────────────────── */}
            <line x1={x0} y1={svgH - V_PAD_B / 2} x2={x1end} y2={svgH - V_PAD_B / 2}
              stroke="#334155" strokeWidth={1} />
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const x = x0 + frac * chartW
              const label = hhmm(new Date(tMin + frac * tRange).toISOString())
              return (
                <g key={frac}>
                  <line x1={x} y1={svgH - V_PAD_B / 2} x2={x} y2={svgH - V_PAD_B / 2 + TICK_H}
                    stroke="#334155" strokeWidth={1} />
                  <text x={x} y={svgH - V_PAD_B / 2 + TICK_H + 9}
                    fontSize={8} fill="#475569" textAnchor="middle">{label}</text>
                </g>
              )
            })}

            {/* ── Main lane ─────────────────────────────────────────── */}
            <line x1={x0} y1={mainY} x2={x1end} y2={mainY}
              stroke={mainColor} strokeWidth={2} strokeOpacity={0.3} />
            <circle cx={x0}    cy={mainY} r={DOT_R} fill={mainColor} />
            <circle cx={x1end} cy={mainY} r={DOT_R} fill="transparent"
              stroke={mainColor} strokeWidth={1.5} />

            {/* ── Subagent lanes ────────────────────────────────────── */}
            {session.subagents.map((agent, ai) => {
              const lane     = ai + 1
              const color    = COLORS[lane % COLORS.length]
              const y        = ly(lane)
              const axStart  = tx(agent.startTime)
              const axEnd    = tx(agent.endTime)
              const startLbl = hhmm(agent.startTime)
              const endLbl   = hhmm(agent.endTime)
              const showEnd  = (axEnd - axStart) > 52 && endLbl !== startLbl

              return (
                <g key={agent.agentId}>
                  {/* Lane line */}
                  <line x1={axStart} y1={y} x2={axEnd} y2={y}
                    stroke={color} strokeWidth={2} strokeOpacity={0.5} />

                  {/* Branch: Main → agent (solid) */}
                  <line x1={axStart} y1={mainY + DOT_R} x2={axStart} y2={y - DOT_R}
                    stroke={color} strokeWidth={1.5} strokeOpacity={0.65} />

                  {/* Merge: agent → Main (dashed) */}
                  <line x1={axEnd} y1={y - DOT_R} x2={axEnd} y2={mainY + DOT_R}
                    stroke={color} strokeWidth={1.5} strokeOpacity={0.55} strokeDasharray="3 2" />

                  {/* Branch dot on Main */}
                  <circle cx={axStart} cy={mainY} r={DOT_R} fill={color} />
                  {/* Merge dot on Main */}
                  <circle cx={axEnd} cy={mainY} r={DOT_R} fill="transparent"
                    stroke={color} strokeWidth={1.5} />

                  {/* Agent start dot */}
                  <circle cx={axStart} cy={y} r={DOT_R} fill={color} />
                  {/* Agent end dot */}
                  <circle cx={axEnd} cy={y} r={DOT_R} fill="transparent"
                    stroke={color} strokeWidth={1.5} />

                  {/* Time labels */}
                  <text x={axStart} y={y + DOT_R + 10} fontSize={8}
                    fill={color} textAnchor="middle" opacity={0.9}>{startLbl}</text>
                  {showEnd && (
                    <text x={axEnd} y={y + DOT_R + 10} fontSize={8}
                      fill={color} textAnchor="middle" opacity={0.65}>{endLbl}</text>
                  )}

                  {/* Invisible hit areas for tooltip */}
                  <circle cx={axStart} cy={y} r={HIT_R} fill="transparent" className="cursor-pointer"
                    onMouseEnter={(e) => showTooltip(e, agent, color)}
                    onMouseMove={(e)  => showTooltip(e, agent, color)}
                  />
                  <circle cx={axEnd} cy={y} r={HIT_R} fill="transparent" className="cursor-pointer"
                    onMouseEnter={(e) => showTooltip(e, agent, color)}
                    onMouseMove={(e)  => showTooltip(e, agent, color)}
                  />
                  {/* Hit area on the lane line itself */}
                  <line x1={axStart} y1={y} x2={axEnd} y2={y}
                    stroke="transparent" strokeWidth={14} className="cursor-pointer"
                    onMouseEnter={(e) => showTooltip(e, agent, color)}
                    onMouseMove={(e)  => showTooltip(e, agent, color)}
                    onMouseLeave={hideTooltip}
                  />
                </g>
              )
            })}
          </svg>

          {/* ── Tooltip ─────────────────────────────────────────────── */}
          {tooltip && (() => {
            const { x, y, agent, color } = tooltip
            const duration = agent.startTime && agent.endTime
              ? new Date(agent.endTime).getTime() - new Date(agent.startTime).getTime()
              : 0
            // Flip left if near right edge
            const flipX = x > containerW * 0.65
            return (
              <div
                className="pointer-events-none absolute z-50 rounded-md border border-border bg-popover px-3 py-2 shadow-md text-xs"
                style={{
                  left:  flipX ? undefined : x + 12,
                  right: flipX ? containerW - x + 12 : undefined,
                  top:   y - 10,
                  minWidth: 180,
                }}
              >
                <div className="flex items-center gap-1.5 mb-1.5 font-semibold text-foreground">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                  {agent.type ?? "agent"}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span>Time</span>
                  <span className="text-foreground font-mono">{hhmm(agent.startTime)} – {hhmm(agent.endTime)}</span>
                  {duration > 0 && (
                    <><span>Duration</span><span className="text-foreground font-mono">{formatDuration(duration)}</span></>
                  )}
                  <span>Tokens</span>
                  <span className="text-foreground font-mono">{formatNumber(agent.tokenUsage.totalTokens)}</span>
                </div>
              </div>
            )
          })()}
        </div>
      </CardContent>
    </Card>
  )
}

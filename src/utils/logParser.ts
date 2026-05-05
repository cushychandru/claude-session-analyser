import type {
  RawLogEntry,
  ContentBlock,
  ParsedMessage,
  ParsedToolCall,
  SubagentInfo,
  SessionAnalysis,
  ProjectAnalysis,
  TokenUsageSummary,
  UploadedFile,
} from "@/types/logs"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractTextFromContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim()
}

function extractThinking(content: string | ContentBlock[] | undefined): string {
  if (!content || typeof content === "string") return ""
  const block = content.find((b) => b.type === "thinking")
  return block ? (block as { type: "thinking"; thinking: string }).thinking : ""
}

function extractToolCalls(
  content: string | ContentBlock[] | undefined,
  messageUuid: string,
  timestamp: string
): ParsedToolCall[] {
  if (!content || typeof content === "string") return []
  return content
    .filter((b) => b.type === "tool_use")
    .map((b) => {
      const tb = b as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      return {
        id: tb.id,
        name: tb.name,
        input: tb.input ?? {},
        messageUuid,
        timestamp,
      }
    })
}

function extractToolResults(content: string | ContentBlock[] | undefined): Record<string, string> {
  if (!content || typeof content === "string") return {}
  const results: Record<string, string> = {}
  for (const block of content) {
    if (block.type === "tool_result") {
      const rb = block as { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[] }
      const resultText =
        typeof rb.content === "string"
          ? rb.content
          : extractTextFromContent(rb.content)
      results[rb.tool_use_id] = resultText
    }
  }
  return results
}

function emptyTokenUsage(): TokenUsageSummary {
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

function addTokenUsage(a: TokenUsageSummary, usage: import("@/types/logs").TokenUsage | undefined): TokenUsageSummary {
  if (!usage) return a
  const inp = (usage.input_tokens ?? 0)
  const out = (usage.output_tokens ?? 0)
  // cache_creation_input_tokens already includes both 5m + 1h ephemeral buckets — do NOT add ephemeral_1h again
  const cc = (usage.cache_creation_input_tokens ?? 0)
  const cr = (usage.cache_read_input_tokens ?? 0)
  const ws = (usage.server_tool_use?.web_search_requests ?? 0)
  const wf = (usage.server_tool_use?.web_fetch_requests ?? 0)
  return {
    inputTokens: a.inputTokens + inp,
    outputTokens: a.outputTokens + out,
    cacheCreationTokens: a.cacheCreationTokens + cc,
    cacheReadTokens: a.cacheReadTokens + cr,
    totalTokens: a.totalTokens + inp + out,
    webSearchRequests: a.webSearchRequests + ws,
    webFetchRequests: a.webFetchRequests + wf,
  }
}

function mergeTokenUsage(a: TokenUsageSummary, b: TokenUsageSummary): TokenUsageSummary {
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

/**
 * Returns every assistant entry that carries a `usage` block — including duplicate
 * lines for the same message.id (one per content block in a streamed response).
 * Filters out synthetic / isMeta rows that aren't real assistant turns.
 *
 * Note: this matches Claude's account-level usage chart, which appears to count
 * raw log rows. The deduplicated count (one per message.id) is lower but is the
 * count actually returned by the API. Keep both behaviors in mind when comparing.
 */
export function dedupeAssistantForTokens(messages: ParsedMessage[]): ParsedMessage[] {
  return messages.filter(
    (m) =>
      m.role === "assistant" &&
      !m.isMeta &&
      m.model !== "<synthetic>" &&
      !!m.usage,
  )
}

function aggregateTokens(messages: ParsedMessage[], opts: { includeSidechain?: boolean } = {}): TokenUsageSummary {
  const filtered = opts.includeSidechain ? messages : messages.filter((m) => !m.isSidechain)
  const rows = dedupeAssistantForTokens(filtered)
  let total = emptyTokenUsage()
  for (const m of rows) total = addTokenUsage(total, m.usage)
  return total
}

// ─── JSONL parser ─────────────────────────────────────────────────────────────

function parseJsonl(text: string): RawLogEntry[] {
  const entries: RawLogEntry[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed) as RawLogEntry)
    } catch {
      // skip malformed lines
    }
  }
  return entries
}

// ─── Parse a single session (main or subagent) ────────────────────────────────

function parseSessionEntries(
  entries: RawLogEntry[],
  sessionId: string
): {
  messages: ParsedMessage[]
  title: string
  startTime: string
  endTime: string
  entrypoint: string
  gitBranch: string
  cwd: string
  version: string
} {
  const messages: ParsedMessage[] = []
  let title = "Untitled Session"
  let startTime = ""
  let endTime = ""
  let entrypoint = ""
  let gitBranch = ""
  let cwd = ""
  let version = ""

  // Collect tool results from user messages to attach to tool calls later
  const toolResultMap: Record<string, string> = {}

  for (const entry of entries) {
    if (entry.timestamp) {
      if (!startTime || entry.timestamp < startTime) startTime = entry.timestamp
      if (!endTime || entry.timestamp > endTime) endTime = entry.timestamp
    }

    if (entry.type === "ai-title" && entry.aiTitle) {
      title = entry.aiTitle
    }

    if (entry.type === "user" || entry.type === "assistant") {
      const msg = entry.message
      if (!msg) continue

      if (!entrypoint && entry.entrypoint) entrypoint = entry.entrypoint
      if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch
      if (!cwd && entry.cwd) cwd = entry.cwd
      if (!version && entry.version) version = entry.version

      const uuid = entry.uuid ?? crypto.randomUUID()
      const timestamp = entry.timestamp ?? ""

      // Collect tool results from user messages
      if (msg.role === "user") {
        const results = extractToolResults(msg.content)
        Object.assign(toolResultMap, results)
      }

      const contentBlocks: ContentBlock[] = typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : (msg.content ?? [])

      const toolCalls = extractToolCalls(msg.content, uuid, timestamp)
      const thinkingText = extractThinking(msg.content)
      const textContent = extractTextFromContent(msg.content)

      messages.push({
        uuid,
        parentUuid: entry.parentUuid ?? null,
        role: msg.role,
        timestamp,
        isSidechain: entry.isSidechain ?? false,
        isMeta: entry.isMeta ?? false,
        agentId: entry.agentId,
        textContent,
        contentBlocks,
        toolCalls,
        hasThinking: thinkingText.length > 0,
        thinkingText,
        usage: msg.usage,
        rawMessageId: msg.id,
        model: msg.model,
        stopReason: msg.stop_reason,
        entrypoint: entry.entrypoint,
        gitBranch: entry.gitBranch,
        cwd: entry.cwd,
        sessionId,
      })
    }
  }

  // Attach tool results to tool calls
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (toolResultMap[tc.id]) {
        tc.result = toolResultMap[tc.id]
      }
    }
  }

  return { messages, title, startTime, endTime, entrypoint, gitBranch, cwd, version }
}

// ─── Detect sessionId from filename ───────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const AGENT_ID_RE = /agent-([a-f0-9]+)/i

function detectFileInfo(filename: string): { sessionId: string; isSubagent: boolean; agentId?: string } {
  // subagent: agent-<hex>.jsonl or agent-<hex>.meta.json
  const agentMatch = AGENT_ID_RE.exec(filename)
  if (agentMatch) {
    return { sessionId: "", isSubagent: true, agentId: agentMatch[1] }
  }
  // main session: <uuid>.jsonl
  const uuidMatch = UUID_RE.exec(filename)
  if (uuidMatch) {
    return { sessionId: uuidMatch[0], isSubagent: false }
  }
  return { sessionId: filename.replace(".jsonl", ""), isSubagent: false }
}

// ─── Main public API ──────────────────────────────────────────────────────────

export async function readUploadedFile(file: File): Promise<UploadedFile> {
  const content = await file.text()
  const info = detectFileInfo(file.name)
  return { name: file.name, ...info, content }
}

export function analyzeFiles(files: UploadedFile[]): ProjectAnalysis {
  // Separate main sessions from subagent files; skip .meta.json
  const mainFiles = files.filter((f) => !f.isSubagent && !f.name.endsWith(".meta.json"))
  const subagentFiles = files.filter((f) => f.isSubagent && !f.name.endsWith(".meta.json"))
  const metaFiles = files.filter((f) => f.name.endsWith(".meta.json"))

  // Build meta map: agentId -> { type, description }
  const metaMap: Record<string, { type?: string; description?: string }> = {}
  for (const mf of metaFiles) {
    try {
      const meta = JSON.parse(mf.content)
      if (mf.agentId) metaMap[mf.agentId] = { type: meta.agentType, description: meta.description }
    } catch { /* skip */ }
  }

  // Group subagent files by agentId
  const subagentMap: Record<string, UploadedFile[]> = {}
  for (const sf of subagentFiles) {
    const key = sf.agentId ?? sf.name
    if (!subagentMap[key]) subagentMap[key] = []
    subagentMap[key].push(sf)
  }

  const sessions: SessionAnalysis[] = []

  if (mainFiles.length === 0 && subagentFiles.length > 0) {
    // Subagent-only upload: combine all agent files into ONE pseudo-session to avoid
    // cross-contamination (each agent would otherwise get all others attached).
    const allSubagents: SubagentInfo[] = []
    let combinedStart = ""
    let combinedEnd = ""

    for (const [agentId, agentFiles] of Object.entries(subagentMap)) {
      const allAgentEntries = agentFiles.flatMap((af) => parseJsonl(af.content))
      const { messages: agentMessages, startTime: aStart, endTime: aEnd } =
        parseSessionEntries(allAgentEntries, "subagents-only")

      const agentTokenUsage = aggregateTokens(agentMessages, { includeSidechain: true })

      const agentToolCalls = agentMessages.flatMap((m) => m.toolCalls)
      allSubagents.push({
        agentId,
        type: metaMap[agentId]?.type,
        description: metaMap[agentId]?.description,
        messages: agentMessages,
        toolCallCount: agentToolCalls.length,
        tokenUsage: agentTokenUsage,
        startTime: aStart,
        endTime: aEnd,
      })
      if (aStart && (!combinedStart || aStart < combinedStart)) combinedStart = aStart
      if (aEnd && aEnd > combinedEnd) combinedEnd = aEnd
    }

    allSubagents.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))

    let combinedTokens = emptyTokenUsage()
    for (const a of allSubagents) combinedTokens = mergeTokenUsage(combinedTokens, a.tokenUsage)

    const combinedDuration = combinedStart && combinedEnd
      ? new Date(combinedEnd).getTime() - new Date(combinedStart).getTime()
      : 0

    const allToolCalls = allSubagents.flatMap((a) => a.messages.flatMap((m) => m.toolCalls))
    const toolCallFreq: Record<string, number> = {}
    for (const tc of allToolCalls) toolCallFreq[tc.name] = (toolCallFreq[tc.name] ?? 0) + 1

    const firstMsg = allSubagents[0]?.messages.find((m) => m.entrypoint || m.gitBranch || m.cwd)

    sessions.push({
      sessionId: "subagents-only",
      title: "Subagent Logs",
      startTime: combinedStart,
      endTime: combinedEnd,
      duration: combinedDuration,
      entrypoint: firstMsg?.entrypoint ?? "",
      gitBranch: firstMsg?.gitBranch ?? "",
      cwd: firstMsg?.cwd ?? "",
      version: "",
      messages: [],
      subagents: allSubagents,
      toolCalls: allToolCalls,
      toolCallFrequency: toolCallFreq,
      tokenUsage: combinedTokens,
      messageCount: { user: 0, assistant: 0, total: 0 },
      hasThinking: allSubagents.some((a) => a.messages.some((m) => m.hasThinking)),
    })
  } else {
    for (const file of mainFiles) {
      const sessionId = file.sessionId || file.name
      const entries = parseJsonl(file.content)

      const { messages, title, startTime, endTime, entrypoint, gitBranch, cwd, version } =
        parseSessionEntries(entries, sessionId)

      // Collect subagents belonging to this session
      const subagents: SubagentInfo[] = []
      const seenAgentIds = new Set<string>()

      // First: subagents from uploaded agent-*.jsonl files
      for (const [agentId, agentFiles] of Object.entries(subagentMap)) {
        const allAgentEntries = agentFiles.flatMap((af) => parseJsonl(af.content))
        const firstEntry = allAgentEntries.find((e) => e.sessionId)
        const agentSessionId = firstEntry?.sessionId ?? ""

        // When only 1 main session, attach all uploaded subagents (no way to distinguish)
        if (agentSessionId === sessionId || mainFiles.length === 1) {
          const { messages: agentMessages, startTime: aStart, endTime: aEnd } =
            parseSessionEntries(allAgentEntries, sessionId)

          const agentTokenUsage = aggregateTokens(agentMessages, { includeSidechain: true })

          const allToolCalls = agentMessages.flatMap((m) => m.toolCalls)

          subagents.push({
            agentId,
            type: metaMap[agentId]?.type,
            description: metaMap[agentId]?.description,
            messages: agentMessages,
            toolCallCount: allToolCalls.length,
            tokenUsage: agentTokenUsage,
            startTime: aStart,
            endTime: aEnd,
          })
          seenAgentIds.add(agentId)
        }
      }

      // Second: extract any remaining subagents from sidechain messages embedded in the main log
      const sidechainByAgent: Record<string, ParsedMessage[]> = {}
      for (const msg of messages) {
        if (msg.isSidechain && msg.agentId && !seenAgentIds.has(msg.agentId)) {
          if (!sidechainByAgent[msg.agentId]) sidechainByAgent[msg.agentId] = []
          sidechainByAgent[msg.agentId].push(msg)
        }
      }
      for (const [agentId, agentMessages] of Object.entries(sidechainByAgent)) {
        const agentTokenUsage = aggregateTokens(agentMessages, { includeSidechain: true })
        const allToolCalls = agentMessages.flatMap((m) => m.toolCalls)
        const timestamps = agentMessages.map((m) => m.timestamp).filter(Boolean).sort()
        subagents.push({
          agentId,
          type: metaMap[agentId]?.type,
          description: metaMap[agentId]?.description,
          messages: agentMessages,
          toolCallCount: allToolCalls.length,
          tokenUsage: agentTokenUsage,
          startTime: timestamps[0] ?? "",
          endTime: timestamps[timestamps.length - 1] ?? "",
        })
      }

      // Sort subagents chronologically (first spawned → last spawned)
      subagents.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))

      // Compute metrics
      const allToolCalls = messages.flatMap((m) => m.toolCalls)
      const toolCallFrequency: Record<string, number> = {}
      for (const tc of allToolCalls) {
        toolCallFrequency[tc.name] = (toolCallFrequency[tc.name] ?? 0) + 1
      }

      // Main session: non-sidechain assistant messages, deduped by message.id
      let tokenUsage = aggregateTokens(messages, { includeSidechain: false })
      // Add all subagent tokens so the session total includes agent activity
      for (const agent of subagents) {
        tokenUsage = mergeTokenUsage(tokenUsage, agent.tokenUsage)
      }

      const userMessages = messages.filter((m) => m.role === "user")
      const assistantMessages = messages.filter((m) => m.role === "assistant")
      const duration = startTime && endTime
        ? new Date(endTime).getTime() - new Date(startTime).getTime()
        : 0

      sessions.push({
        sessionId,
        title,
        startTime,
        endTime,
        duration,
        entrypoint,
        gitBranch,
        cwd,
        version,
        messages,
        subagents,
        toolCalls: allToolCalls,
        toolCallFrequency,
        tokenUsage,
        messageCount: { user: userMessages.length, assistant: assistantMessages.length, total: messages.length },
        hasThinking: messages.some((m) => m.hasThinking),
      })
    }
  }

  // Sort sessions by start time
  sessions.sort((a, b) => (a.startTime > b.startTime ? -1 : 1))

  // Aggregate project-level metrics
  const globalToolFreq: Record<string, number> = {}
  let globalTokens = emptyTokenUsage()
  const entrypoints: Record<string, number> = {}
  const models: Record<string, number> = {}

  let timeStart = ""
  let timeEnd = ""

  for (const s of sessions) {
    for (const [k, v] of Object.entries(s.toolCallFrequency)) {
      globalToolFreq[k] = (globalToolFreq[k] ?? 0) + v
    }
    globalTokens = mergeTokenUsage(globalTokens, s.tokenUsage)
    if (s.entrypoint) entrypoints[s.entrypoint] = (entrypoints[s.entrypoint] ?? 0) + 1
    for (const m of s.messages) {
      if (m.model) models[m.model] = (models[m.model] ?? 0) + 1
    }
    if (s.startTime && (!timeStart || s.startTime < timeStart)) timeStart = s.startTime
    if (s.endTime && (!timeEnd || s.endTime > timeEnd)) timeEnd = s.endTime
  }

  const topTools = Object.entries(globalToolFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }))

  const totalSubagents = sessions.reduce((n, s) => n + s.subagents.length, 0)

  return {
    sessions,
    totalSessions: sessions.length,
    totalMessages: sessions.reduce((n, s) => n + s.messageCount.total, 0),
    totalToolCalls: sessions.reduce((n, s) => n + s.toolCalls.length, 0),
    totalTokens: globalTokens,
    totalSubagents,
    toolCallFrequency: globalToolFreq,
    topTools,
    timeRange: { start: timeStart, end: timeEnd },
    entrypoints,
    models,
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatTimestamp(ts: string): string {
  if (!ts) return "—"
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(ts))
  } catch {
    return ts
  }
}

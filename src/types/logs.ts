// ─── Raw log entry types ──────────────────────────────────────────────────────

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[] }
  | { type: string; [key: string]: unknown }

export interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number }
}

export interface RawMessage {
  role: "user" | "assistant"
  content: string | ContentBlock[]
  model?: string
  id?: string
  stop_reason?: string
  usage?: TokenUsage
  type?: string
}

export type LogEntryType =
  | "user"
  | "assistant"
  | "attachment"
  | "queue-operation"
  | "file-history-snapshot"
  | "ai-title"
  | string

export interface RawLogEntry {
  type: LogEntryType
  uuid?: string
  parentUuid?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  agentId?: string
  promptId?: string
  sessionId?: string
  timestamp?: string
  message?: RawMessage
  requestId?: string
  userType?: string
  entrypoint?: string
  cwd?: string
  version?: string
  gitBranch?: string
  permissionMode?: string
  // ai-title
  aiTitle?: string
  // attachment subtypes
  subtype?: string
  // queue-operation
  operation?: string
  // file-history-snapshot
  snapshot?: unknown
}

// ─── Parsed / enriched types ──────────────────────────────────────────────────

export interface ParsedToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  /** uuid of the message that contains this tool_use */
  messageUuid: string
  timestamp: string
}

export interface ParsedMessage {
  uuid: string
  parentUuid: string | null
  role: "user" | "assistant"
  timestamp: string
  isSidechain: boolean
  isMeta: boolean
  agentId?: string
  /** Flat text extracted from all text blocks */
  textContent: string
  /** Raw content blocks */
  contentBlocks: ContentBlock[]
  toolCalls: ParsedToolCall[]
  hasThinking: boolean
  thinkingText: string
  usage?: TokenUsage
  /** Anthropic API message id (msg_…) — same id is repeated across streamed chunks */
  rawMessageId?: string
  model?: string
  stopReason?: string
  entrypoint?: string
  gitBranch?: string
  cwd?: string
  sessionId: string
}

export interface SubagentInfo {
  agentId: string
  type?: string
  description?: string
  messages: ParsedMessage[]
  toolCallCount: number
  tokenUsage: TokenUsageSummary
  startTime: string
  endTime: string
}

export interface TokenUsageSummary {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  webSearchRequests: number
  webFetchRequests: number
}

export interface SessionAnalysis {
  sessionId: string
  title: string
  startTime: string
  endTime: string
  duration: number
  entrypoint: string
  gitBranch: string
  cwd: string
  version: string
  messages: ParsedMessage[]
  subagents: SubagentInfo[]
  toolCalls: ParsedToolCall[]
  toolCallFrequency: Record<string, number>
  tokenUsage: TokenUsageSummary
  messageCount: { user: number; assistant: number; total: number }
  hasThinking: boolean
}

export interface ProjectAnalysis {
  sessions: SessionAnalysis[]
  totalSessions: number
  totalMessages: number
  totalToolCalls: number
  totalTokens: TokenUsageSummary
  totalSubagents: number
  toolCallFrequency: Record<string, number>
  topTools: Array<{ name: string; count: number }>
  timeRange: { start: string; end: string }
  entrypoints: Record<string, number>
  models: Record<string, number>
}

export interface UploadedFile {
  name: string
  sessionId: string
  isSubagent: boolean
  agentId?: string
  content: string
}

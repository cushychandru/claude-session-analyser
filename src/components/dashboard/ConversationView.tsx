import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { User, Bot, Brain, Wrench, ChevronDown, ChevronRight, FileText, Zap, Settings } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { formatTimestamp, formatNumber } from "@/utils/logParser"
import type { ParsedMessage, ContentBlock } from "@/types/logs"
import { cn } from "@/lib/utils"

interface ConversationViewProps {
  messages: ParsedMessage[]
  title?: string
  showSidechain?: boolean
}

// Merge consecutive assistant messages that share the same parentUuid (same API turn)
function groupMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const result: ParsedMessage[] = []
  for (const msg of messages) {
    const prev = result[result.length - 1]
    if (
      prev &&
      prev.role === "assistant" &&
      msg.role === "assistant" &&
      msg.parentUuid === prev.parentUuid &&
      msg.isSidechain === prev.isSidechain
    ) {
      // Merge into previous bubble
      result[result.length - 1] = {
        ...prev,
        contentBlocks: [...prev.contentBlocks, ...msg.contentBlocks],
        toolCalls: [...prev.toolCalls, ...msg.toolCalls],
        textContent: [prev.textContent, msg.textContent].filter(Boolean).join("\n"),
        hasThinking: prev.hasThinking || msg.hasThinking,
        thinkingText: [prev.thinkingText, msg.thinkingText].filter(Boolean).join("\n"),
        usage: prev.usage ?? msg.usage,
      }
    } else {
      result.push(msg)
    }
  }
  return result
}

export function ConversationView({ messages, title, showSidechain }: ConversationViewProps) {
  const mainMessages = groupMessages(showSidechain ? messages : messages.filter((m) => !m.isSidechain))

  if (mainMessages.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        No messages in this session
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        {title && (
          <div className="pb-3 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{mainMessages.length} messages</p>
          </div>
        )}
        {mainMessages.map((msg) => (
          <MessageBubble key={msg.uuid} message={msg} />
        ))}
      </div>
    </ScrollArea>
  )
}

// Extract /command <args> from Claude Code XML tags
function parseCommand(text: string): { name: string; args: string } | null {
  const nameMatch = text.match(/<command-name>([\s\S]*?)<\/command-name>/)
  if (!nameMatch) return null
  const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/)
  return {
    name: nameMatch[1].trim(),
    args: argsMatch ? argsMatch[1].trim() : "",
  }
}

// True when a user message only contains tool results (no real user text)
function isToolResultOnly(blocks: ContentBlock[]): boolean {
  const nonEmpty = blocks.filter((b) => {
    if (b.type === "tool_result") return true
    if (b.type === "text") return (b as { type: "text"; text: string }).text.trim().length > 0
    return false
  })
  return nonEmpty.length > 0 && nonEmpty.every((b) => b.type === "tool_result")
}

function MessageBubble({ message }: { message: ParsedMessage }) {
  const isUser = message.role === "user"

  // isMeta = system-injected context (skill docs, CLAUDE.md, etc.) — show collapsed
  if (message.isMeta) {
    return <SystemContextBlock message={message} />
  }

  // User messages that are purely tool results — show inline without User header
  if (isUser && isToolResultOnly(message.contentBlocks)) {
    return (
      <div className="flex gap-3 pl-1">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5 bg-muted/40">
          <FileText className="h-3.5 w-3.5 text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <ContentBlocks blocks={message.contentBlocks} />
        </div>
      </div>
    )
  }

  // For real user messages, try to extract the /command <args>
  const rawText = message.textContent
  const command = isUser ? parseCommand(rawText) : null

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5",
          isUser ? "bg-blue-500/20" : "bg-violet-500/20"
        )}
      >
        {isUser
          ? <User className="h-3.5 w-3.5 text-blue-400" />
          : <Bot className="h-3.5 w-3.5 text-violet-400" />}
      </div>

      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-semibold text-foreground">
            {isUser ? "User" : (message.model ? message.model.replace("claude-", "Claude ") : "Assistant")}
          </span>
          <span className="text-xs text-muted-foreground">{formatTimestamp(message.timestamp)}</span>
          {message.usage && (
            <Tooltip
              className="text-left"
              content={
                <span className="flex flex-col gap-0.5">
                  <span>Input: {formatNumber(message.usage.input_tokens ?? 0)}</span>
                  <span>Output: {formatNumber(message.usage.output_tokens ?? 0)}</span>
                  {(message.usage.cache_read_input_tokens ?? 0) > 0 && (
                    <span>Cache Read: {formatNumber(message.usage.cache_read_input_tokens ?? 0)}</span>
                  )}
                  {(message.usage.cache_creation_input_tokens ?? 0) > 0 && (
                    <span>Cache Write: {formatNumber(message.usage.cache_creation_input_tokens ?? 0)}</span>
                  )}
                </span>
              }
            >
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground cursor-default">
                <Zap className="h-3 w-3" />
                {formatNumber((message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0))} tok
              </span>
            </Tooltip>
          )}
        </div>

        {/* Content */}
        {command ? (
          <p className="text-sm text-foreground font-mono bg-muted/40 rounded px-2 py-1 inline-block">
            {command.name}{command.args ? ` ${command.args}` : ""}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {message.hasThinking && message.thinkingText && (
              <ThinkingBlock text={message.thinkingText} />
            )}
            <ContentBlocks blocks={message.contentBlocks} />
          </div>
        )}
      </div>
    </div>
  )
}

function SystemContextBlock({ message }: { message: ParsedMessage }) {
  const [expanded, setExpanded] = useState(false)
  const preview = message.textContent.slice(0, 120).replace(/\n/g, " ")

  return (
    <div className="flex gap-3 opacity-60 hover:opacity-80 transition-opacity">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5 bg-muted">
        <Settings className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <button
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="font-semibold">System Context</span>
          <span className="text-[10px]">{formatTimestamp(message.timestamp)}</span>
          {expanded
            ? <ChevronDown className="h-3 w-3 ml-auto shrink-0" />
            : <ChevronRight className="h-3 w-3 ml-auto shrink-0" />}
        </button>
        {!expanded && (
          <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{preview}</p>
        )}
        {expanded && (
          <div className="mt-2 text-xs text-muted-foreground border border-border/50 rounded p-2 bg-muted/20 max-h-64 overflow-y-auto">
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {message.textContent}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const preview = text.slice(0, 200)

  return (
    <div className="thinking-block rounded-md p-3 text-xs">
      <button
        className="flex items-center gap-1.5 text-violet-400 font-medium mb-1"
        onClick={() => setExpanded(!expanded)}
      >
        <Brain className="h-3 w-3" />
        Extended Thinking
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="text-muted-foreground font-normal ml-1">({text.length.toLocaleString()} chars)</span>
      </button>
      {expanded ? (
        <div className="text-muted-foreground text-[11px] leading-relaxed font-mono whitespace-pre-wrap">
          {text}
        </div>
      ) : (
        <p className="text-muted-foreground whitespace-pre-wrap font-mono text-[11px] leading-relaxed line-clamp-3">
          {preview}
        </p>
      )}
    </div>
  )
}

const MD_COMPONENTS: import("react-markdown").Components = {
  h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 text-foreground border-b border-border pb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1.5 text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 text-muted-foreground">{children}</h4>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-")
    return isBlock
      ? <code className={cn("block text-[11px] font-mono text-green-300", className)}>{children}</code>
      : <code className="px-1 py-0.5 rounded bg-muted text-[11px] font-mono text-amber-300">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="my-2 p-3 rounded-md bg-muted/60 border border-border overflow-x-auto text-[11px] font-mono leading-relaxed">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 pl-3 border-l-2 border-primary/40 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-muted-foreground">{children}</em>,
  hr: () => <hr className="my-3 border-border" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse border border-border">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="px-2 py-1 border border-border bg-muted font-semibold text-left">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 border border-border">{children}</td>,
}

function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  const textBlocks = blocks.filter((b) => b.type === "text")
  const toolUseBlocks = blocks.filter((b) => b.type === "tool_use")
  const toolResultBlocks = blocks.filter((b) => b.type === "tool_result")

  return (
    <div className="flex flex-col gap-2">
      {textBlocks.map((b, i) => {
        const tb = b as { type: "text"; text: string }
        if (!tb.text?.trim()) return null
        return (
          <div key={i} className="markdown-body text-sm text-foreground leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {tb.text}
            </ReactMarkdown>
          </div>
        )
      })}

      {toolUseBlocks.map((b, i) => (
        <ToolUseBlock key={i} block={b as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }} />
      ))}

      {toolResultBlocks.map((b, i) => (
        <ToolResultBlock key={i} block={b as { type: "tool_result"; tool_use_id: string; content: string }} />
      ))}
    </div>
  )
}

function ToolUseBlock({ block }: { block: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } }) {
  const [expanded, setExpanded] = useState(false)
  const inputStr = JSON.stringify(block.input, null, 2)
  const preview = Object.entries(block.input)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 60)}`)
    .join(", ")

  return (
    <div className="tool-use-block rounded-md p-3">
      <button
        className="flex items-center gap-2 w-full"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="h-3.5 w-3.5 text-green-400 shrink-0" />
        <Badge variant="success" className="font-mono">{block.name}</Badge>
        {!expanded && (
          <span className="text-xs text-muted-foreground truncate flex-1 text-left">{preview}</span>
        )}
        {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" /> : <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto" />}
      </button>
      {expanded && (
        <pre className="mt-2 text-[11px] text-muted-foreground font-mono overflow-x-auto p-2 bg-muted/40 rounded">
          {inputStr}
        </pre>
      )}
    </div>
  )
}

function ToolResultBlock({ block }: { block: { type: "tool_result"; tool_use_id: string; content: string } }) {
  const [expanded, setExpanded] = useState(false)
  const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content)
  const preview = content.slice(0, 200)
  const isLong = content.length > 200

  return (
    <div className="tool-result-block rounded-md p-3">
      <button
        className="flex items-center gap-2 w-full mb-1"
        onClick={() => setExpanded(!expanded)}
        disabled={!isLong}
      >
        <FileText className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
        <span className="text-xs text-cyan-400 font-medium">Tool Result</span>
        <span className="text-xs text-muted-foreground font-mono truncate flex-1 text-left">
          {block.tool_use_id.slice(-8)}
        </span>
        {isLong && (
          expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" /> : <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto" />
        )}
      </button>
      <pre className="text-[11px] text-muted-foreground font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
        {expanded || !isLong ? content : preview + "…"}
      </pre>
    </div>
  )
}

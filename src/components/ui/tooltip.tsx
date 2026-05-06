import { useState } from "react"
import { cn } from "@/lib/utils"

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  className?: string
  side?: "top" | "right"
}

export function Tooltip({ content, children, className, side = "top" }: TooltipProps) {
  const [show, setShow] = useState(false)

  const positionClass = side === "right"
    ? "left-full top-1/2 -translate-y-1/2 ml-2"
    : "bottom-full left-1/2 -translate-x-1/2 mb-1"

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          className={cn(
            "absolute z-50 pointer-events-none",
            "rounded-md bg-[#1e1e2e] border border-border text-popover-foreground shadow-xl",
            "px-3 py-2 text-xs",
            positionClass,
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}

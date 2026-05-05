import { cn } from "@/lib/utils"

interface BadgeProps {
  children: React.ReactNode
  variant?: "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
  className?: string
}

const variantClasses = {
  default: "bg-primary/20 text-primary border-primary/30",
  secondary: "bg-secondary text-secondary-foreground border-border",
  success: "bg-green-500/15 text-green-400 border-green-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  destructive: "bg-red-500/15 text-red-400 border-red-500/30",
  outline: "bg-transparent text-foreground border-border",
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

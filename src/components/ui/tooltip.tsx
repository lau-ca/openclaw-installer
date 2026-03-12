import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({ content, children, side = "bottom", className }: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleEnter() {
    timeoutRef.current = setTimeout(() => setVisible(true), 400);
  }

  function handleLeave() {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  }

  const positionClass =
    side === "top" ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5" :
    side === "bottom" ? "top-full left-1/2 -translate-x-1/2 mt-1.5" :
    side === "left" ? "right-full top-1/2 -translate-y-1/2 mr-1.5" :
    "left-full top-1/2 -translate-y-1/2 ml-1.5";

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {visible && (
        <div
          className={cn(
            "absolute z-50 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] text-background shadow-md pointer-events-none animate-in fade-in-0 zoom-in-95",
            positionClass,
            className,
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}

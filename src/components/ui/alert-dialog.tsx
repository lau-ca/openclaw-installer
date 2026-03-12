import * as React from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, XCircle, Info, CheckCircle2, X } from "lucide-react";

type ToastKind = "error" | "warning" | "info" | "success";

interface ToastProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  kind?: ToastKind;
  /** 自动关闭时间（毫秒），默认 4000，设为 0 则不自动关闭 */
  duration?: number;
}

const kindConfig: Record<
  ToastKind,
  { icon: typeof XCircle; iconClass: string; borderClass: string; bgClass: string }
> = {
  error: {
    icon: XCircle,
    iconClass: "text-red-400",
    borderClass: "border-red-500/25",
    bgClass: "bg-red-500/[0.06]",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-yellow-400",
    borderClass: "border-yellow-500/25",
    bgClass: "bg-yellow-500/[0.06]",
  },
  info: {
    icon: Info,
    iconClass: "text-primary",
    borderClass: "border-primary/25",
    bgClass: "bg-primary/[0.06]",
  },
  success: {
    icon: CheckCircle2,
    iconClass: "text-green-400",
    borderClass: "border-green-500/25",
    bgClass: "bg-green-500/[0.06]",
  },
};

export function Toast({
  open,
  onClose,
  title,
  message,
  kind = "error",
  duration = 4000,
}: ToastProps) {
  const { icon: Icon, iconClass, borderClass, bgClass } = kindConfig[kind];

  React.useEffect(() => {
    if (!open || duration === 0) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [open, onClose, duration]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -20, x: 0 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, y: -20, x: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "fixed top-4 right-4 z-50 w-80",
            "rounded-lg border shadow-lg backdrop-blur-md px-4 py-3",
            borderClass,
            bgClass
          )}
        >
          <div className="flex items-start gap-3">
            <Icon
              className={cn("w-4 h-4 shrink-0 mt-0.5", iconClass)}
              strokeWidth={2}
            />
            <div className="flex-1 min-w-0">
              {title && (
                <div className="text-[13px] font-semibold text-foreground mb-0.5">
                  {title}
                </div>
              )}
              <div className="text-[12px] text-muted-foreground leading-relaxed break-all">
                {message}
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

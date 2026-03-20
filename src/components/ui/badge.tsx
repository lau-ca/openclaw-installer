/**
 * Badge 组件
 * 用于显示标签：推荐、最快设置、需插件、精选、弃用
 */

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-primary/10 text-primary border-primary/30",
        success:
          "bg-success/10 text-success border-success/30",
        warning:
          "bg-warning/10 text-warning border-warning/30",
        danger:
          "bg-destructive/10 text-destructive border-destructive/30",
        info:
          "bg-[rgba(55,114,207,0.1)] text-[#3772CF] border-[#3772CF]/30",
        muted:
          "bg-secondary text-muted-foreground border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  icon?: LucideIcon;
}

function Badge({ className, variant, icon: Icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
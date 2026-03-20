/**
 * PlatformCard 组件
 * 显示单个平台卡片
 */

import { memo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import type { Platform, PlatformTag } from "@/lib/channels-data";
import { tagConfig } from "@/lib/channels-data";

interface PlatformCardProps {
  platform: Platform;
  index: number;
}

export const PlatformCard = memo(function PlatformCard({ platform, index }: PlatformCardProps) {
  const Icon = platform.icon;

  return (
    <motion.a
      href={platform.docUrl}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.05,
        duration: 0.4,
        ease: [0.4, 0, 0.2, 1],
      }}
      className={cn(
        "group relative flex flex-col rounded-[14px] border border-[#E6E1DE] bg-[#FFFFFF] p-5",
        "transition-all duration-250 ease-out",
        "hover:-translate-y-1 hover:border-[#D6D1CE] hover:shadow-[0_8px_24px_rgba(30,25,24,0.08)]",
        "active:scale-[0.99]",
        "cursor-pointer block no-underline"
      )}
    >
      {/* Header: Icon + Name */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F5F0EF] text-[#575250]">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="font-semibold text-[#1E1918]">{platform.name}</h3>
      </div>

      {/* Tags */}
      {platform.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {platform.tags.map((tag) => {
            const config = tagConfig[tag];
            const TagIcon = config.icon;
            const variant = getBadgeVariant(tag);
            return (
              <Badge key={tag} variant={variant} icon={TagIcon}>
                {config.label}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Description */}
      <p className="flex-1 text-sm text-[#575250] leading-relaxed mb-4">
        {platform.description}
      </p>

      {/* Footer: Link */}
      <div className="flex items-center gap-1 text-sm font-medium text-[#2563EB]">
        <span>View docs</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </div>
    </motion.a>
  );
});

/** 根据标签类型获取 Badge 变体 */
function getBadgeVariant(tag: PlatformTag) {
  switch (tag) {
    case "recommended":
    case "featured":
      return "success";
    case "fastest":
      return "warning";
    case "plugin":
      return "info";
    case "deprecated":
      return "danger";
    default:
      return "default";
  }
}
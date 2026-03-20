/**
 * CategoryTabs 组件
 * 分类标签切换
 */

import { cn } from "@/lib/utils";
import type { CategoryInfo, PlatformCategory } from "@/lib/channels-data";

interface CategoryTabsProps {
  categories: CategoryInfo[];
  activeCategory: PlatformCategory | "all";
  onChange: (category: PlatformCategory | "all") => void;
}

export function CategoryTabs({
  categories,
  activeCategory,
  onChange,
}: CategoryTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {categories.map((category) => {
        const isActive = activeCategory === category.id;
        return (
          <button
            type="button"
            key={category.id}
            onClick={() => onChange(category.id as PlatformCategory | "all")}
            className={cn(
              "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150",
              isActive
                ? "bg-[#1E1918] text-white"
                : "text-[#575250] hover:bg-[#F5F0EF] hover:text-[#1E1918]"
            )}
          >
            <span className="relative z-10">
              {category.label}
              <span className="ml-1.5 text-xs opacity-60">({category.count})</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
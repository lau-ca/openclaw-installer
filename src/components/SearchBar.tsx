/**
 * SearchBar 组件
 * 搜索平台
 */

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search platforms...",
  className,
}: SearchBarProps) {
  return (
    <div
      className={cn(
        "relative flex items-center rounded-[10px] border border-[#E6E1DE] bg-[#F5F0EF] transition-all duration-200",
        "focus-within:border-2 focus-within:border-[#2563EB] focus-within:bg-white",
        "focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.1)]",
        className
      )}
    >
      <Search className="absolute left-4 h-5 w-5 text-[#A8A29E]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search platforms"
        className={cn(
          "h-12 w-full bg-transparent px-12 py-2 text-[#1E1918] placeholder:text-[#A8A29E]",
          "focus:outline-none"
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-4 flex h-6 w-6 items-center justify-center rounded-full bg-[#E6E1DE] text-[#575250] hover:bg-[#D6D1CE]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
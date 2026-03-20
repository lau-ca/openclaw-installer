/**
 * ChannelsPage 主页面
 * 平台列表展示页面
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SearchBar } from "@/components/SearchBar";
import { CategoryTabs } from "@/components/CategoryTabs";
import { PlatformCard } from "@/components/PlatformCard";
import { SearchX } from "lucide-react";
import { platforms, categories, type PlatformCategory } from "@/lib/channels-data";

/** Debounce hook */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

export function ChannelsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<PlatformCategory | "all">("all");

  // Debounce 搜索输入，避免频繁过滤
  const debouncedSearch = useDebounce(searchQuery, 150);

  // 过滤平台列表 - 使用 useMemo 缓存
  const filteredPlatforms = useMemo(() => {
    return platforms.filter((platform) => {
      // 分类过滤
      if (activeCategory !== "all" && platform.category !== activeCategory) {
        return false;
      }
      // 搜索过滤
      if (debouncedSearch) {
        const query = debouncedSearch.toLowerCase();
        return (
          platform.name.toLowerCase().includes(query) ||
          platform.description.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [debouncedSearch, activeCategory]);

  // 使用 useCallback 优化回调
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleCategoryChange = useCallback((category: PlatformCategory | "all") => {
    setActiveCategory(category);
  }, []);

  return (
    <div className="min-h-screen bg-[#FAF9F8]">
      {/* Header */}
      <div className="border-b border-[#E6E1DE] bg-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold text-[#1E1918]"
          >
            Chat Channels
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-2 text-[#575250]"
          >
            OpenClaw can talk to you on any chat app you already use. Each channel connects via the Gateway.
          </motion.p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="border-b border-[#E6E1DE] bg-[#FAF9F8] sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <SearchBar
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full lg:w-80"
            />
            <CategoryTabs
              categories={categories}
              activeCategory={activeCategory}
              onChange={handleCategoryChange}
            />
          </div>
        </div>
      </div>

      {/* Platform Grid */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <AnimatePresence mode="wait">
          {filteredPlatforms.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <SearchX className="mb-4 h-16 w-16 text-[#A8A29E]" />
              <h3 className="text-lg font-medium text-[#1E1918]">No platforms found</h3>
              <p className="text-[#575250]">
                Try adjusting your search or filter criteria
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={`${activeCategory}-${searchQuery}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {filteredPlatforms.map((platform, index) => (
                <PlatformCard
                  key={platform.id}
                  platform={platform}
                  index={index}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer Notes */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-[14px] border border-[#E6E1DE] bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold text-[#1E1918]">Notes</h3>
          <ul className="space-y-2 text-sm text-[#575250]">
            <li>
              • Channels can run simultaneously; configure multiple and OpenClaw will route per chat.
            </li>
            <li>
              • Fastest setup is usually{" "}
              <span className="font-medium text-[#C37D0D]">Telegram</span> (simple bot token).
            </li>
            <li>
              • Group behavior varies by channel; see{" "}
              <a href="/channels/groups" className="text-[#2563EB] hover:underline">
                Groups
              </a>
              .
            </li>
            <li>
              • DM pairing and allowlists are enforced for safety; see{" "}
              <a href="/gateway/security" className="text-[#2563EB] hover:underline">
                Security
              </a>
              .
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
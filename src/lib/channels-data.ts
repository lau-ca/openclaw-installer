/**
 * 平台数据配置
 * 基于 docs.openclaw.ai/channels 提取
 */

import type { LucideIcon } from "lucide-react";
import {
  MessageCircle,
  Phone,
  Hash,
  MapPin,
  Users,
  Send,
  Radio,
  Gamepad2,
  MessageSquare,
  Waves,
  Star,
  Zap,
  Plug,
  AlertTriangle,
} from "lucide-react";

/** 平台分类 */
export type PlatformCategory =
  | "messaging"    // 消息
  | "enterprise"   // 企业
  | "decentralized" // 去中心化
  | "selfhosted"   // 自托管
  | "deprecated";  // 弃用

/** 平台标签 */
export type PlatformTag =
  | "recommended"  // 推荐
  | "fastest"       // 最快设置
  | "plugin"        // 需插件
  | "featured"      // 精选
  | "deprecated";   // 弃用

/** 平台接口 */
export interface Platform {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  category: PlatformCategory;
  tags: PlatformTag[];
  docUrl: string;
}

/** 分类信息 */
export interface CategoryInfo {
  id: PlatformCategory | "all";
  label: string;
  count: number;
}

/** 平台列表数据 */
export const platforms: Platform[] = [
  // iMessage
  {
    id: "bluebubbles",
    name: "BlueBubbles",
    icon: MessageCircle,
    description:
      "Recommended for iMessage; uses the BlueBubbles macOS server REST API with full feature support (edit, unsend, effects, reactions, group management — edit currently broken on macOS 26 Tahoe).",
    category: "messaging",
    tags: ["recommended", "featured"],
    docUrl: "/channels/bluebubbles",
  },
  // Discord
  {
    id: "discord",
    name: "Discord",
    icon: Hash,
    description:
      "Discord Bot API + Gateway; supports servers, channels, and DMs.",
    category: "messaging",
    tags: [],
    docUrl: "/channels/discord",
  },
  // Feishu
  {
    id: "feishu",
    name: "Feishu",
    icon: MessageSquare,
    description:
      "Feishu/Lark bot via WebSocket (plugin, installed separately).",
    category: "messaging",
    tags: ["plugin"],
    docUrl: "/channels/feishu",
  },
  // Google Chat
  {
    id: "googlechat",
    name: "Google Chat",
    icon: MessageSquare,
    description:
      "Google Chat API app via HTTP webhook.",
    category: "enterprise",
    tags: [],
    docUrl: "/channels/googlechat",
  },
  // iMessage (legacy)
  {
    id: "imessage",
    name: "iMessage (legacy)",
    icon: MessageCircle,
    description:
      "Legacy macOS integration via imsg CLI (deprecated, use BlueBubbles for new setups).",
    category: "messaging",
    tags: ["deprecated"],
    docUrl: "/channels/imessage",
  },
  // IRC
  {
    id: "irc",
    name: "IRC",
    icon: Radio,
    description:
      "Classic IRC servers; channels + DMs with pairing/allowlist controls.",
    category: "messaging",
    tags: [],
    docUrl: "/channels/irc",
  },
  // LINE
  {
    id: "line",
    name: "LINE",
    icon: MessageCircle,
    description:
      "LINE Messaging API bot (plugin, installed separately).",
    category: "messaging",
    tags: ["plugin"],
    docUrl: "/channels/line",
  },
  // Matrix
  {
    id: "matrix",
    name: "Matrix",
    icon: MapPin,
    description:
      "Matrix protocol (plugin, installed separately).",
    category: "decentralized",
    tags: ["plugin"],
    docUrl: "/channels/matrix",
  },
  // Mattermost
  {
    id: "mattermost",
    name: "Mattermost",
    icon: Users,
    description:
      "Bot API + WebSocket; channels, groups, DMs (plugin, installed separately).",
    category: "enterprise",
    tags: ["plugin"],
    docUrl: "/channels/mattermost",
  },
  // Microsoft Teams
  {
    id: "msteams",
    name: "Microsoft Teams",
    icon: Users,
    description:
      "Bot Framework; enterprise support (plugin, installed separately).",
    category: "enterprise",
    tags: ["plugin"],
    docUrl: "/channels/msteams",
  },
  // Nextcloud Talk
  {
    id: "nextcloud-talk",
    name: "Nextcloud Talk",
    icon: MessageSquare,
    description:
      "Self-hosted chat via Nextcloud Talk (plugin, installed separately).",
    category: "selfhosted",
    tags: ["plugin"],
    docUrl: "/channels/nextcloud-talk",
  },
  // Nostr
  {
    id: "nostr",
    name: "Nostr",
    icon: Zap,
    description:
      "Decentralized DMs via NIP-04 (plugin, installed separately).",
    category: "decentralized",
    tags: ["plugin"],
    docUrl: "/channels/nostr",
  },
  // Signal
  {
    id: "signal",
    name: "Signal",
    icon: Waves,
    description:
      "signal-cli; privacy-focused.",
    category: "messaging",
    tags: [],
    docUrl: "/channels/signal",
  },
  // Synology Chat
  {
    id: "synology-chat",
    name: "Synology Chat",
    icon: MessageSquare,
    description:
      "Synology NAS Chat via outgoing+incoming webhooks (plugin, installed separately).",
    category: "selfhosted",
    tags: ["plugin"],
    docUrl: "/channels/synology-chat",
  },
  // Slack
  {
    id: "slack",
    name: "Slack",
    icon: MessageSquare,
    description:
      "Bolt SDK; workspace apps.",
    category: "enterprise",
    tags: [],
    docUrl: "/channels/slack",
  },
  // Telegram
  {
    id: "telegram",
    name: "Telegram",
    icon: Send,
    description:
      "Bot API via grammY; supports groups.",
    category: "messaging",
    tags: ["fastest"],
    docUrl: "/channels/telegram",
  },
  // Tlon
  {
    id: "tlon",
    name: "Tlon",
    icon: MapPin,
    description:
      "Urbit-based messenger (plugin, installed separately).",
    category: "decentralized",
    tags: ["plugin"],
    docUrl: "/channels/tlon",
  },
  // Twitch
  {
    id: "twitch",
    name: "Twitch",
    icon: Gamepad2,
    description:
      "Twitch chat via IRC connection (plugin, installed separately).",
    category: "messaging",
    tags: ["plugin"],
    docUrl: "/channels/twitch",
  },
  // WhatsApp
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: Phone,
    description:
      "Most popular; uses Baileys and requires QR pairing.",
    category: "messaging",
    tags: [],
    docUrl: "/channels/whatsapp",
  },
  // Zalo
  {
    id: "zalo",
    name: "Zalo",
    icon: MessageCircle,
    description:
      "Zalo Bot API; Vietnam's popular messenger (plugin, installed separately).",
    category: "messaging",
    tags: ["plugin"],
    docUrl: "/channels/zalo",
  },
  // Zalo Personal
  {
    id: "zalouser",
    name: "Zalo Personal",
    icon: MessageCircle,
    description:
      "Zalo personal account via QR login (plugin, installed separately).",
    category: "messaging",
    tags: ["plugin"],
    docUrl: "/channels/zalouser",
  },
];

/** 分类配置 */
export const categories: CategoryInfo[] = [
  { id: "all", label: "All", count: platforms.length },
  {
    id: "messaging",
    label: "Messaging",
    count: platforms.filter((p) => p.category === "messaging").length,
  },
  {
    id: "enterprise",
    label: "Enterprise",
    count: platforms.filter((p) => p.category === "enterprise").length,
  },
  {
    id: "decentralized",
    label: "Decentralized",
    count: platforms.filter((p) => p.category === "decentralized").length,
  },
  {
    id: "selfhosted",
    label: "Self-hosted",
    count: platforms.filter((p) => p.category === "selfhosted").length,
  },
  {
    id: "deprecated",
    label: "Deprecated",
    count: platforms.filter((p) => p.category === "deprecated").length,
  },
];

/** 标签配置 */
export const tagConfig: Record<PlatformTag, { label: string; icon: LucideIcon }> = {
  recommended: { label: "Recommended", icon: Star },
  fastest: { label: "Fastest setup", icon: Zap },
  plugin: { label: "Requires plugin", icon: Plug },
  featured: { label: "Featured", icon: Star },
  deprecated: { label: "Deprecated", icon: AlertTriangle },
};
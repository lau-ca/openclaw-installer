import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ResourceWithId } from "@/lib/db";
import { resourceArgs } from "@/lib/tauri";
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
  Download,
  ExternalLink,
  MessageSquare,
} from "lucide-react";

// ── Types ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>;

interface FeishuConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  domain: string;
  connectionMode: string;
  dmPolicy: string;
  typingIndicator: boolean;
  resolveSenderNames: boolean;
}

interface DingtalkConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  robotCode: string;
  corpId: string;
  agentId: string;
  dmPolicy: string;
  groupPolicy: string;
  showThinking: boolean;
  thinkingMessage: string;
  debug: boolean;
  messageType: string;
}

interface WecomConfig {
  enabled: boolean;
  botId: string;
  secret: string;
  dmPolicy: string;
}

const defaultFeishu: FeishuConfig = {
  enabled: false,
  appId: "",
  appSecret: "",
  domain: "feishu",
  connectionMode: "websocket",
  dmPolicy: "open",
  typingIndicator: false,
  resolveSenderNames: false,
};

const defaultDingtalk: DingtalkConfig = {
  enabled: false,
  clientId: "",
  clientSecret: "",
  robotCode: "",
  corpId: "",
  agentId: "",
  dmPolicy: "open",
  groupPolicy: "open",
  showThinking: true,
  thinkingMessage: "思考中，请稍候...",
  debug: false,
  messageType: "markdown",
};

const defaultWecom: WecomConfig = {
  enabled: false,
  botId: "",
  secret: "",
  dmPolicy: "open",
};

// ── Channel Icons ───────────────────────────────

function FeishuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="currentColor">
      <path d="M25.6 4.8c-1.3 1.4-2.7 3.5-4.6 7.2L10.1 23.3c2.4-3.2 5.5-8.7 11.6-11.3 4.4-1.9 7.7-.8 10.1.1.5-4-.3-6.4-.7-7.2-.7-1.5-3.2-1.4-4.5-.1z" opacity=".6"/>
      <path d="M5.1 29c1.6-1.5 3.9-3.5 5-6.3 4.5 4.9 14.1 12.6 26.1 10.9-2.9 4.7-11.5 14.2-27.9 10.3-2.4-.6-5.4-2.3-5.2-5 .2-2.5.7-5.9 2-9.9z"/>
      <path d="M36.1 33.6c1.9-.3 4.2-1.2 6.3-3.1 2.1-2 2.8-4.9 2.5-6.1-1.2-4.1-8.2-6.6-14.2-12.4-3.4 3.7-12.5 12.8-20.6 10.7 6.9 6.2 18.7 12.3 26.1 10.9z" opacity=".8"/>
    </svg>
  );
}

function DingtalkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.95 7.47c-.17.42-1 1.18-2.45 2.27l-.33.24.53 2.15-3.55-2.24c-.92.37-1.74.5-2.37.47-.65-.04-1.62-.33-2.47-1.47l3.6-.53-1.18-3.2 3.22 1.96c.93-.72 1.92-1.36 2.64-1.66 1.3-.55 2.58-.37 2.95.11.36.48.58 1.1.41 1.9z"/>
    </svg>
  );
}

function WecomIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.8 3.6C4.9 3.6 1.8 6.2 1.8 9.5c0 1.8 1 3.4 2.7 4.5-.1.5-.5 1.6-1.6 2.6.8-.1 2.3-.4 3.8-1.5.7.2 1.4.3 2.1.3.3 0 .7 0 1-.1-.2-.5-.3-1.1-.3-1.7 0-3.3 3.2-6 7-6h.2c-.7-2.4-3.9-4-7.9-4z"/>
      <path d="M22.2 13.6c0-2.8-2.8-5-6.2-5s-6.2 2.2-6.2 5 2.8 5 6.2 5c.6 0 1.1-.1 1.6-.2 1.2.9 2.5 1.1 3.1 1.2-.9-.8-1.2-1.7-1.3-2.1 1.5-.9 2.5-2.3 2.5-3.9h.3z"/>
    </svg>
  );
}

// ── Props ────────────────────────────────────────

interface CommunicationPanelProps {
  resource: ResourceWithId | null;
  configPath?: string | null;
}

// ── Component ────────────────────────────────────

export default function CommunicationPanel({ resource, configPath }: CommunicationPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  // Channel states
  const [feishu, setFeishu] = useState<FeishuConfig>({ ...defaultFeishu });
  const [dingtalk, setDingtalk] = useState<DingtalkConfig>({ ...defaultDingtalk });
  const [wecom, setWecom] = useState<WecomConfig>({ ...defaultWecom });


  // ── Load config ────────────────────────────────

  const loadConfig = useCallback(async () => {
    if (!resource) return;
    setLoading(true);
    try {
      const raw = await invoke<string>("read_openclaw_config", {
        ...resourceArgs(resource),
        configPath: configPath ?? undefined,
      });
      const parsed: AnyConfig = JSON.parse(raw);
      const channels = parsed.channels ?? {};


      if (channels.feishu) {
        const f = channels.feishu;
        const enabled = f.enabled === true;
        setFeishu({
          enabled,
          appId: f.appId || "",
          appSecret: f.appSecret || "",
          domain: f.domain || "feishu",
          connectionMode: f.connectionMode || "websocket",
          dmPolicy: f.dmPolicy || "open",
          typingIndicator: f.typingIndicator === true,
          resolveSenderNames: f.resolveSenderNames === true,
        });
      } else {
        setFeishu({ ...defaultFeishu });
      }

      if (channels.dingtalk) {
        const d = channels.dingtalk;
        const enabled = d.enabled === true;
        setDingtalk({
          enabled,
          clientId: d.clientId || "",
          clientSecret: d.clientSecret || "",
          robotCode: d.robotCode || "",
          corpId: d.corpId || "",
          agentId: d.agentId || "",
          dmPolicy: d.dmPolicy || "open",
          groupPolicy: d.groupPolicy || "open",
          showThinking: d.showThinking !== false,
          thinkingMessage: d.thinkingMessage || "思考中，请稍候...",
          debug: d.debug === true,
          messageType: d.messageType || "markdown",
        });
      } else {
        setDingtalk({ ...defaultDingtalk });
      }

      if (channels.wecom) {
        const w = channels.wecom;
        const enabled = w.enabled === true;
        setWecom({
          enabled,
          botId: w.botId || "",
          secret: w.secret || "",
          dmPolicy: w.dmPolicy || "open",
        });
      } else {
        setWecom({ ...defaultWecom });
      }
    } catch (err) {
      console.error("读取通讯配置失败:", err);
    } finally {
      setLoading(false);
    }
  }, [resource, configPath]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // ── Save handler ──────────────────────────────

  async function handleSave() {
    if (!resource) return;
    setSaving(true);
    setSaveMsg(null);

    try {
      const rArgs = resourceArgs(resource);

      // Channels that need a third-party plugin (feishu is built-in)
      const pluginChannels: string[] = [];
      if (dingtalk.enabled) pluginChannels.push("dingtalk");
      if (wecom.enabled) pluginChannels.push("wecom");

      // ── Step 1: Clean config BEFORE plugin install ──
      // openclaw CLI validates config on every command. If config already has
      // channels.dingtalk or plugins.allow referencing an uninstalled plugin,
      // `openclaw plugins install` itself fails (chicken-and-egg).
      // Fix: temporarily remove plugin-channel entries + stale plugins.allow/entries.
      { // Always clean to remove stale entries
        const cleanPatch: AnyConfig = {
          channels: {} as AnyConfig,
          plugins: {
            allow: null,
            entries: {
              // Remove all plugin entries first, will be restored after install
              dingtalk: null,
              wecom: null,
              feishu: null, // feishu should not be in entries (built-in)
            },
          },
        };
        for (const ch of pluginChannels) {
          cleanPatch.channels[ch] = null;
        }
        await invoke("patch_openclaw_config", {
          ...rArgs,
          patch: JSON.stringify(cleanPatch),
          configPath: configPath ?? undefined,
        });
      }

      // ── Step 2: Install each channel's plugin ──
      for (const ch of pluginChannels) {
        setInstalling(ch);
        try {
          await invoke("install_openclaw_integration", {
            channel: ch,
            ...rArgs,
          });
        } catch (err) {
          const errStr = String(err);
          if (errStr.includes("already") || errStr.includes("up to date") || errStr.includes("已安装")) {
            // plugin already installed — OK
          } else {
            console.error(`安装 ${ch} 插件失败:`, err);
            setSaveMsg({ type: "err", text: `${ch} 插件安装失败: ${err}` });
            return;
          }
        }
        setInstalling(null);
      }

      // ── Step 3: Write the actual channel config back ──
      const channelsPatch: AnyConfig = {};

      if (feishu.enabled) {
        channelsPatch.feishu = {
          enabled: true,
          appId: feishu.appId,
          appSecret: feishu.appSecret,
          domain: feishu.domain,
          connectionMode: feishu.connectionMode,
          dmPolicy: feishu.dmPolicy,
          typingIndicator: feishu.typingIndicator,
          resolveSenderNames: feishu.resolveSenderNames,
        };
      } else {
        channelsPatch.feishu = null;
      }

      if (dingtalk.enabled) {
        const dtPatch: AnyConfig = {
          enabled: true,
          clientId: dingtalk.clientId,
          clientSecret: dingtalk.clientSecret,
          dmPolicy: dingtalk.dmPolicy,
          groupPolicy: dingtalk.groupPolicy,
          showThinking: dingtalk.showThinking,
          thinkingMessage: dingtalk.thinkingMessage,
          debug: dingtalk.debug,
          messageType: dingtalk.messageType,
        };
        if (dingtalk.robotCode) dtPatch.robotCode = dingtalk.robotCode;
        if (dingtalk.corpId) dtPatch.corpId = dingtalk.corpId;
        if (dingtalk.agentId) dtPatch.agentId = dingtalk.agentId;
        channelsPatch.dingtalk = dtPatch;
      } else {
        channelsPatch.dingtalk = null;
      }

      if (wecom.enabled) {
        channelsPatch.wecom = {
          enabled: true,
          botId: wecom.botId,
          secret: wecom.secret,
          dmPolicy: wecom.dmPolicy,
        };
      } else {
        channelsPatch.wecom = null;
      }

      // Build plugins.allow list and entries from enabled plugin channels only
      // Note: feishu is built-in, so it should NOT be in plugins.entries
      const allowList: string[] = [];
      const pluginEntries: AnyConfig = {};
      if (dingtalk.enabled) {
        allowList.push("dingtalk");
        pluginEntries.dingtalk = { enabled: true };
      } else {
        pluginEntries.dingtalk = null;
      }
      if (wecom.enabled) {
        allowList.push("wecom");
        pluginEntries.wecom = { enabled: true };
      } else {
        pluginEntries.wecom = null;
      }
      // feishu is built-in, no plugin entries needed - must set to null to remove via deep_merge
      pluginEntries.feishu = null;

      await invoke("patch_openclaw_config", {
        ...rArgs,
        patch: JSON.stringify({
          channels: channelsPatch,
          plugins: {
            allow: allowList.length > 0 ? allowList : null,
            entries: pluginEntries,
          },
        }),
        configPath: configPath ?? undefined,
      });

      // ── Step 4: Auto-restart gateway if running ──
      let restarted = false;
      try {
        const daemonRaw = await invoke<string>("get_daemon_info", rArgs);
        const daemonInfo = JSON.parse(daemonRaw);
        if (daemonInfo.runtime === "running") {
          setSaveMsg({ type: "ok", text: "配置已保存，正在重启网关..." });
          await invoke<string>("gateway_control", { action: "restart", ...rArgs });
          restarted = true;
        }
      } catch {
        // Ignore errors - gateway might not be installed/running
      }

      setSaveMsg({
        type: "ok",
        text: restarted ? "通讯配置已保存，网关已重启" : "通讯配置已保存"
      });
      await loadConfig();
    } catch (err) {
      setSaveMsg({ type: "err", text: `保存失败: ${err}` });
    } finally {
      setSaving(false);
      setInstalling(null);
    }
  }

  // ── Validation ────────────────────────────────

  const feishuValid = !feishu.enabled || (!!feishu.appId && !!feishu.appSecret);
  const dingtalkValid = !dingtalk.enabled || (!!dingtalk.clientId && !!dingtalk.clientSecret);
  const wecomValid = !wecom.enabled || (!!wecom.botId && !!wecom.secret);
  const canSave = feishuValid && dingtalkValid && wecomValid;

  // ── Loading ────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto space-y-4 pr-1">
        {/* ── 飞书 ── */}
        <ChannelSection
          title="飞书"
          subtitle="Feishu / Lark"
          icon={<FeishuIcon className={cn("w-4 h-4", feishu.enabled ? "text-primary" : "text-muted-foreground")} />}
          enabled={feishu.enabled}
          valid={feishuValid}
          onToggle={(v) => setFeishu((p) => ({ ...p, enabled: v }))}
        >
          <div className="space-y-3">
            <div>
              <Label required>App ID</Label>
              <Input
                value={feishu.appId}
                onChange={(e) => setFeishu((p) => ({ ...p, appId: e.target.value }))}
                placeholder="cli_xxxxxx"
                className="text-[13px] h-9"
              />
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[11px] text-muted-foreground flex-1">
                  飞书开放平台 → 应用管理 → 凭证与基础信息
                </p>
                <button
                  type="button"
                  onClick={() => openUrl(feishu.domain === "lark" ? "https://open.larksuite.com/app" : "https://open.feishu.cn/app")}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  前往配置
                </button>
              </div>
            </div>
            <div>
              <Label required>App Secret</Label>
              <Input
                value={feishu.appSecret}
                onChange={(e) => setFeishu((p) => ({ ...p, appSecret: e.target.value }))}
                placeholder="your-app-secret"
                type="password"
                className="text-[13px] h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>平台</Label>
                <Select value={feishu.domain} onChange={(e) => setFeishu((p) => ({ ...p, domain: e.target.value }))}>
                  <option value="feishu">飞书（feishu.cn）</option>
                  <option value="lark">Lark（国际版）</option>
                </Select>
              </div>
              <div>
                <Label>连接模式</Label>
                <Select value={feishu.connectionMode} onChange={(e) => setFeishu((p) => ({ ...p, connectionMode: e.target.value }))}>
                  <option value="websocket">WebSocket（推荐）</option>
                  <option value="webhook">Webhook</option>
                </Select>
              </div>
            </div>
            <div>
              <Label>私聊策略</Label>
              <Select value={feishu.dmPolicy} onChange={(e) => setFeishu((p) => ({ ...p, dmPolicy: e.target.value }))}>
                <option value="open">open（所有人可私聊）</option>
                <option value="allowlist">allowlist（白名单）</option>
              </Select>
            </div>
            <div className="flex gap-6">
              <Checkbox
                checked={feishu.typingIndicator}
                onChange={(e) => setFeishu((p) => ({ ...p, typingIndicator: e.target.checked }))}
                label="显示正在输入"
              />
              <Checkbox
                checked={feishu.resolveSenderNames}
                onChange={(e) => setFeishu((p) => ({ ...p, resolveSenderNames: e.target.checked }))}
                label="解析发送者名称"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              WebSocket 模式无需公网 IP，飞书开放平台需启用「事件订阅」并选择 WebSocket 方式。
              <button type="button" onClick={() => openUrl("https://open.feishu.cn/document/home/develop-a-bot-in-5-minutes/create-an-app")} className="text-primary hover:underline ml-1">查看文档</button>
            </p>
          </div>
        </ChannelSection>

        {/* ── 钉钉 ── */}
        <ChannelSection
          title="钉钉"
          subtitle="DingTalk"
          icon={<DingtalkIcon className={cn("w-4 h-4", dingtalk.enabled ? "text-primary" : "text-muted-foreground")} />}
          enabled={dingtalk.enabled}
          valid={dingtalkValid}
          onToggle={(v) => setDingtalk((p) => ({ ...p, enabled: v }))}
        >
          <div className="space-y-3">
            <div>
              <Label required>Client ID</Label>
              <Input
                value={dingtalk.clientId}
                onChange={(e) => setDingtalk((p) => ({ ...p, clientId: e.target.value }))}
                placeholder="dingxxxxxx"
                className="text-[13px] h-9"
              />
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[11px] text-muted-foreground flex-1">
                  钉钉开放平台 → 应用开发 → 企业内部开发 → 凭证信息
                </p>
                <button
                  type="button"
                  onClick={() => openUrl("https://open-dev.dingtalk.com/fe/app")}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  前往配置
                </button>
              </div>
            </div>
            <div>
              <Label required>Client Secret</Label>
              <Input
                value={dingtalk.clientSecret}
                onChange={(e) => setDingtalk((p) => ({ ...p, clientSecret: e.target.value }))}
                placeholder="your-secret"
                type="password"
                className="text-[13px] h-9"
              />
            </div>
            <div>
              <Label>Robot Code</Label>
              <Input
                value={dingtalk.robotCode}
                onChange={(e) => setDingtalk((p) => ({ ...p, robotCode: e.target.value }))}
                placeholder="dingxxxxxx（通常与 Client ID 相同）"
                className="text-[13px] h-9"
              />
              <p className="text-[11px] text-muted-foreground">推荐填写，用于媒体下载和卡片发送</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Corp ID</Label>
                <Input
                  value={dingtalk.corpId}
                  onChange={(e) => setDingtalk((p) => ({ ...p, corpId: e.target.value }))}
                  placeholder="dingxxxxxx"
                  className="text-[13px] h-9"
                />
              </div>
              <div>
                <Label>Agent ID</Label>
                <Input
                  value={dingtalk.agentId}
                  onChange={(e) => setDingtalk((p) => ({ ...p, agentId: e.target.value }))}
                  placeholder="123456789"
                  className="text-[13px] h-9"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>私聊策略</Label>
                <Select value={dingtalk.dmPolicy} onChange={(e) => setDingtalk((p) => ({ ...p, dmPolicy: e.target.value }))}>
                  <option value="open">open（所有人可私聊）</option>
                  <option value="pairing">pairing（配对码验证）</option>
                  <option value="allowlist">allowlist（白名单）</option>
                </Select>
              </div>
              <div>
                <Label>群聊策略</Label>
                <Select value={dingtalk.groupPolicy} onChange={(e) => setDingtalk((p) => ({ ...p, groupPolicy: e.target.value }))}>
                  <option value="open">open（所有群可用）</option>
                  <option value="allowlist">allowlist（白名单）</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>消息类型</Label>
                <Select value={dingtalk.messageType} onChange={(e) => setDingtalk((p) => ({ ...p, messageType: e.target.value }))}>
                  <option value="markdown">markdown（默认）</option>
                  <option value="card">card（AI 互动卡片）</option>
                </Select>
              </div>
              <div>
                <Label>思考提示语</Label>
                <Input
                  value={dingtalk.thinkingMessage}
                  onChange={(e) => setDingtalk((p) => ({ ...p, thinkingMessage: e.target.value }))}
                  placeholder="思考中，请稍候..."
                  className="text-[13px] h-9"
                  disabled={!dingtalk.showThinking}
                />
              </div>
            </div>
            <div className="flex gap-6">
              <Checkbox
                checked={dingtalk.showThinking}
                onChange={(e) => setDingtalk((p) => ({ ...p, showThinking: e.target.checked }))}
                label="显示思考中提示"
              />
              <Checkbox
                checked={dingtalk.debug}
                onChange={(e) => setDingtalk((p) => ({ ...p, debug: e.target.checked }))}
                label="调试模式"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              需在钉钉开放平台创建企业内部应用，并开启机器人能力和 Stream 模式。
              <button type="button" onClick={() => openUrl("https://open.dingtalk.com/document/orgapp/create-a-robot")} className="text-primary hover:underline ml-1">查看文档</button>
            </p>
          </div>
        </ChannelSection>

        {/* ── 企业微信 ── */}
        <ChannelSection
          title="企业微信"
          subtitle="WeCom"
          icon={<WecomIcon className={cn("w-4 h-4", wecom.enabled ? "text-primary" : "text-muted-foreground")} />}
          enabled={wecom.enabled}
          valid={wecomValid}
          onToggle={(v) => setWecom((p) => ({ ...p, enabled: v }))}
        >
          <div className="space-y-3">
            <div>
              <Label required>Bot ID</Label>
              <Input
                value={wecom.botId}
                onChange={(e) => setWecom((p) => ({ ...p, botId: e.target.value }))}
                placeholder="aib-open-xxx"
                className="text-[13px] h-9"
              />
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[11px] text-muted-foreground flex-1">
                  企业微信管理后台 → 应用管理 → 自建应用 / 智能客服
                </p>
                <button
                  type="button"
                  onClick={() => openUrl("https://work.weixin.qq.com/wework_admin/frame#apps")}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  前往配置
                </button>
              </div>
            </div>
            <div>
              <Label required>Secret</Label>
              <Input
                value={wecom.secret}
                onChange={(e) => setWecom((p) => ({ ...p, secret: e.target.value }))}
                placeholder="your-secret"
                type="password"
                className="text-[13px] h-9"
              />
            </div>
            <div>
              <Label>私聊策略</Label>
              <Select value={wecom.dmPolicy} onChange={(e) => setWecom((p) => ({ ...p, dmPolicy: e.target.value }))}>
                <option value="open">open（所有人可私聊）</option>
                <option value="allowlist">allowlist（白名单）</option>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              需在企业微信管理后台创建自建应用并配置回调地址。
              <button type="button" onClick={() => openUrl("https://developer.work.weixin.qq.com/document/path/90487")} className="text-primary hover:underline ml-1">查看文档</button>
            </p>
          </div>
        </ChannelSection>
      </div>

      {/* Footer */}
      <div className="shrink-0 pt-3 mt-3 border-t border-border/60 flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || !canSave}>
          {saving ? (
            installing ? (
              <>
                <Download className="w-4 h-4 mr-2 animate-bounce" />
                安装 {installing} 集成...
              </>
            ) : (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                保存中...
              </>
            )
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              保存配置
            </>
          )}
        </Button>
        {!canSave && !saving && (
          <span className="text-[11px] text-amber-600">请填写已启用通道的必填字段</span>
        )}
        {saveMsg && (
          <span className={cn("text-[12px]", saveMsg.type === "ok" ? "text-green-500" : "text-red-400")}>
            {saveMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Sub-component: Channel section card ──────────

function ChannelSection({
  title,
  subtitle,
  icon,
  enabled,
  valid,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  enabled: boolean;
  valid: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border p-4 transition-colors",
        enabled
          ? valid
            ? "border-primary/30 bg-primary/5"
            : "border-amber-300/50 bg-amber-50/30"
          : "border-border/60 bg-white"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {icon ?? (
            <MessageSquare
              className={cn("w-4 h-4", enabled ? "text-primary" : "text-muted-foreground")}
              strokeWidth={1.5}
            />
          )}
          <div>
            <span className="text-[13px] font-semibold text-foreground">{title}</span>
            <span className="text-[11px] text-muted-foreground ml-2">{subtitle}</span>
          </div>
          {enabled && valid && (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" strokeWidth={2} />
          )}
          {enabled && !valid && (
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" strokeWidth={2} />
          )}
        </div>
        <Checkbox
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          label={enabled ? "已启用" : "未启用"}
        />
      </div>
      {enabled && <div className="mt-3">{children}</div>}
    </section>
  );
}

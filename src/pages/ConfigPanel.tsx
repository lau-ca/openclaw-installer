import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  Plus,
  Trash2,
  ExternalLink,
  X,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

// ── Types ────────────────────────────────────────

interface ProviderModel {
  id: string;
  name: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  api?: string;
  models: ProviderModel[];
}

interface ProviderEntry {
  id: string;
  config: ProviderConfig;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>;

// ── Built-in model presets ──────────────────────

interface BuiltinModelGroup {
  provider: string;
  label: string;
  models: { id: string; label: string }[];
}

// Built-in provider env key definitions
interface BuiltinEnvKey {
  key: string;
  label: string;
  provider: string;
  placeholder: string;
}

const BUILTIN_ENV_KEYS: BuiltinEnvKey[] = [
  { key: "ANTHROPIC_API_KEY", label: "Anthropic", provider: "anthropic", placeholder: "sk-ant-..." },
  { key: "OPENAI_API_KEY", label: "OpenAI", provider: "openai", placeholder: "sk-..." },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter", provider: "openrouter", placeholder: "sk-or-..." },
  { key: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Google Gemini", provider: "google", placeholder: "AI..." },
  { key: "GROQ_API_KEY", label: "Groq", provider: "groq", placeholder: "gsk-..." },
  { key: "MISTRAL_API_KEY", label: "Mistral", provider: "mistral", placeholder: "..." },
  { key: "MINIMAX_API_KEY", label: "MiniMax", provider: "minimax", placeholder: "..." },
  { key: "ZAI_API_KEY", label: "Z.AI", provider: "zai", placeholder: "..." },
  { key: "MOONSHOT_API_KEY", label: "Moonshot (Kimi)", provider: "moonshot", placeholder: "..." },
  { key: "DASHSCOPE_API_KEY", label: "通义千问 (Qwen)", provider: "qwen", placeholder: "sk-..." },
];

const BUILTIN_MODELS: BuiltinModelGroup[] = [
  {
    provider: "anthropic",
    label: "Anthropic",
    models: [
      { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "anthropic/claude-haiku-3-5", label: "Claude Haiku 3.5" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    models: [
      { id: "openai/gpt-5.4", label: "GPT-5.4" },
      { id: "openai/gpt-5.2", label: "GPT-5.2" },
      { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
      { id: "openai/gpt-5.2-mini", label: "GPT-5.2 Mini" },
      { id: "openai/o3", label: "o3" },
      { id: "openai/o4-mini", label: "o4-mini" },
    ],
  },
  {
    provider: "google",
    label: "Google Gemini",
    models: [
      { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
      { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash" },
      { id: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
    ],
  },
  {
    provider: "openrouter",
    label: "OpenRouter",
    models: [
      { id: "openrouter/anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5 (via OR)" },
      { id: "openrouter/qwen/qwen-2.5-vl-72b-instruct:free", label: "Qwen 2.5 VL 72B (free)" },
      { id: "openrouter/google/gemini-2.0-flash-vision:free", label: "Gemini 2.0 Flash Vision (free)" },
    ],
  },
  {
    provider: "minimax",
    label: "MiniMax",
    models: [
      { id: "minimax/MiniMax-M2.5", label: "MiniMax M2.5" },
    ],
  },
  {
    provider: "zai",
    label: "Z.AI",
    models: [
      { id: "zai/zai-1.5", label: "ZAI 1.5" },
    ],
  },
  {
    provider: "moonshot",
    label: "Moonshot (Kimi)",
    models: [
      { id: "moonshot/kimi-k2.5", label: "Kimi K2.5" },
    ],
  },
  {
    provider: "qwen",
    label: "Qwen (通义千问)",
    models: [
      { id: "qwen/qwen3-coder-plus", label: "Qwen3 Coder Plus" },
    ],
  },
];

export interface ConfigStatus {
  loaded: boolean;
  hasProvider: boolean;
  hasModel: boolean;
  isComplete: boolean;
}

// ── Helper: check config completeness ────────────

export function checkConfigStatus(config: AnyConfig | null): ConfigStatus {
  if (!config) return { loaded: false, hasProvider: false, hasModel: false, isComplete: false };

  // Check if any env keys (API keys for built-in providers) are set
  const envObj: Record<string, string> = config.env ?? {};
  const hasEnvKey = BUILTIN_ENV_KEYS.some((def) => !!envObj[def.key]);

  // Check if any custom provider has baseUrl + apiKey
  const providers: Record<string, ProviderConfig> = config.models?.providers ?? {};
  const hasCustomProvider = Object.values(providers).some(
    (p) => p.baseUrl && p.apiKey,
  );
  const hasProvider = hasEnvKey || hasCustomProvider;

  const modelRaw = config.agents?.defaults?.model;
  const primary = typeof modelRaw === "string" ? modelRaw : modelRaw?.primary;
  const hasModel = !!primary && primary.length > 0;

  return { loaded: true, hasProvider, hasModel, isComplete: hasProvider && hasModel };
}

// ── Tab definitions ──────────────────────────────

const configTabs = [
  { id: "basic", label: "基本配置" },
  { id: "model", label: "模型配置" },
  { id: "agent", label: "Agent 设置" },
  { id: "session", label: "会话配置" },
  { id: "logging", label: "日志配置" },
] as const;
type TabId = (typeof configTabs)[number]["id"];

// ── Props ────────────────────────────────────────

interface ConfigPanelProps {
  resource: ResourceWithId | null;
  onConfigChange?: (status: ConfigStatus) => void;
  configPath?: string | null;
}

// ── Component ────────────────────────────────────

export default function ConfigPanel({ resource, onConfigChange, configPath }: ConfigPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("basic");

  // ── 部署日志弹窗 ──────────────────────────────
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployStatus, setDeployStatus] = useState<"running" | "success" | "error">("running");
  const deployLogEndRef = useRef<HTMLDivElement>(null);

  // ── 基本配置 tab state ─────────────────────────
  const [gatewayPort, setGatewayPort] = useState("18789");
  const [gwBind, setGwBind] = useState("loopback");
  const [gwAuthMode, setGwAuthMode] = useState("token");
  const [gwAuthToken, setGwAuthToken] = useState("");
  const [workspace, setWorkspace] = useState("~/.openclaw/workspace");
  const [userTimezone, setUserTimezone] = useState("");
  const [timeFormat, setTimeFormat] = useState("auto");
  const [gwMode, setGwMode] = useState("local");
  const [gwControlUi, setGwControlUi] = useState(true);
  const [gwControlUiBasePath, setGwControlUiBasePath] = useState("/openclaw");

  // ── HTTPS 代理配置 ──────────────────────────────
  const [httpsProxyEnabled, setHttpsProxyEnabled] = useState(false);
  const [httpsProxyPort, setHttpsProxyPort] = useState("18790");
  const [lanIp, setLanIp] = useState("");  // 本机局域网 IP（local+lan 时使用）

  const isRemote = resource?.type === "remote";
  // 当前资源的访问 IP：远程用 resource.host，本机用检测到的 lanIp
  const effectiveHost = isRemote ? (resource?.host || "") : lanIp;

  // ── commands 配置 ────────────────────────────────
  const [cmdNative, setCmdNative] = useState("auto");
  const [cmdNativeSkills, setCmdNativeSkills] = useState("auto");
  const [cmdOwnerDisplay, setCmdOwnerDisplay] = useState("raw");
  const [cmdRestart, setCmdRestart] = useState(false);

  // ── 模型配置 tab state ─────────────────────────
  const [modelsMode, setModelsMode] = useState("merge");
  const [envKeys, setEnvKeys] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [primaryModel, setPrimaryModel] = useState("");
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [imageModel, setImageModel] = useState("");
  const [pdfModel, setPdfModel] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState("1");
  const [timeoutSeconds, setTimeoutSeconds] = useState("600");
  const [thinkingDefault, setThinkingDefault] = useState("low");
  const [verboseDefault, setVerboseDefault] = useState("off");
  const [elevatedDefault, setElevatedDefault] = useState("on");
  const [mediaMaxMb, setMediaMaxMb] = useState("5");
  const [contextTokens, setContextTokens] = useState("200000");
  const [compactionMode, setCompactionMode] = useState("safeguard");

  // ── Agent 设置 tab state ───────────────────────
  const [identityName, setIdentityName] = useState("");
  const [identityTheme, setIdentityTheme] = useState("");
  const [identityEmoji, setIdentityEmoji] = useState("");
  const [responsePrefix, setResponsePrefix] = useState("");
  const [ackReaction, setAckReaction] = useState("");

  // ── 会话配置 tab state ─────────────────────────
  const [dmScope, setDmScope] = useState("main");
  const [resetMode, setResetMode] = useState("");
  const [resetAtHour, setResetAtHour] = useState("4");
  const [resetIdleMinutes, setResetIdleMinutes] = useState("60");
  const [resetTriggers, setResetTriggers] = useState<string[]>(["/new", "/reset"]);
  const [newResetTrigger, setNewResetTrigger] = useState("");

  // ── 日志配置 tab state ─────────────────────────
  const [logLevel, setLogLevel] = useState("info");
  const [logFile, setLogFile] = useState("");
  const [consoleLevel, setConsoleLevel] = useState("info");
  const [redactSensitive, setRedactSensitive] = useState("tools");

  // 记录从服务端加载的 provider IDs，用于保存时清理已删除的 provider
  const loadedProviderIds = useRef<string[]>([]);

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

      // 基本配置 —— 优先使用服务端实际值，仅在字段未设置时应用默认值
      const isRemoteRes = resource.type === "remote";
      const gw = parsed.gateway ?? {};
      const gwAuth = gw.auth ?? {};
      const gwCui = gw.controlUi ?? {};

      setGwMode(gw.mode || "local");
      setGatewayPort(String(gw.port ?? 18789));

      // bind / HTTPS 代理 / 认证模式
      if (isRemoteRes) {
        // 远程 Linux：lan + HTTPS 代理 + token 认证（Caddy 仅做 TLS 终止）
        setGwBind("lan");
        setHttpsProxyEnabled(true);
        // 使用服务端实际值，默认 token（避免 trusted-proxy 导致 sessions_spawn unauthorized）
        const remoteAuthMode = gwAuth.mode || "token";
        setGwAuthMode(remoteAuthMode);
      } else {
        // 本机：有值用实际值，未设置时默认 loopback
        const bindHasValue = gw.bind !== undefined && gw.bind !== null;
        setGwBind(bindHasValue ? gw.bind : "loopback");

        const authModeHasValue = gwAuth.mode !== undefined && gwAuth.mode !== null;
        if (authModeHasValue) {
          setGwAuthMode(gwAuth.mode);
          setHttpsProxyEnabled(gwAuth.mode === "trusted-proxy");
        } else {
          setGwAuthMode("token");
          setHttpsProxyEnabled(false);
        }
      }

      setGwAuthToken(gwAuth.token || "");
      setWorkspace(parsed.agents?.defaults?.workspace || "~/.openclaw/workspace");
      setUserTimezone(parsed.agents?.defaults?.userTimezone || "");
      setTimeFormat(parsed.agents?.defaults?.timeFormat || "auto");
      setGwControlUi(gwCui.enabled !== false);
      setGwControlUiBasePath(gwCui.basePath || "/openclaw");

      // 从 allowedOrigins 中提取 HTTPS 端口
      const origins: string[] = gwCui.allowedOrigins || [];
      const httpsOrigin = origins.find((o: string) => o.startsWith("https://"));
      if (httpsOrigin) {
        const portMatch = httpsOrigin.match(/:(\d+)$/);
        if (portMatch) setHttpsProxyPort(portMatch[1]);
      }

      // commands
      setCmdNative(parsed.commands?.native ?? "auto");
      setCmdNativeSkills(parsed.commands?.nativeSkills ?? "auto");
      setCmdOwnerDisplay(parsed.commands?.ownerDisplay ?? "raw");
      setCmdRestart(parsed.commands?.restart === true);

      // 模型配置
      setModelsMode(parsed.models?.mode || "merge");
      // env keys (built-in provider API keys)
      const rawEnv: Record<string, string> = {};
      for (const def of BUILTIN_ENV_KEYS) {
        const val = parsed.env?.[def.key] || "";
        if (val) rawEnv[def.key] = val;
      }
      setEnvKeys(rawEnv);
      const rawProviders: Record<string, ProviderConfig> = parsed.models?.providers ?? {};
      loadedProviderIds.current = Object.keys(rawProviders);
      setProviders(
        Object.entries(rawProviders).map(([id, cfg]) => ({
          id,
          config: {
            baseUrl: cfg.baseUrl || "",
            apiKey: cfg.apiKey || "",
            api: cfg.api || "openai-completions",
            models: cfg.models || [],
          },
        })),
      );
      const modelRaw = parsed.agents?.defaults?.model;
      if (typeof modelRaw === "string") {
        setPrimaryModel(modelRaw);
        setFallbackModels([]);
      } else {
        setPrimaryModel(modelRaw?.primary || "");
        setFallbackModels(modelRaw?.fallbacks || []);
      }
      const imgModel = parsed.agents?.defaults?.imageModel;
      setImageModel(typeof imgModel === "string" ? imgModel : imgModel?.primary || "");
      const pdfM = parsed.agents?.defaults?.pdfModel;
      setPdfModel(typeof pdfM === "string" ? pdfM : pdfM?.primary || "");
      setMaxConcurrent(String(parsed.agents?.defaults?.maxConcurrent ?? 1));
      setTimeoutSeconds(String(parsed.agents?.defaults?.timeoutSeconds ?? 600));
      setThinkingDefault(parsed.agents?.defaults?.thinkingDefault || "low");
      setVerboseDefault(parsed.agents?.defaults?.verboseDefault || "off");
      setElevatedDefault(parsed.agents?.defaults?.elevatedDefault || "on");
      setMediaMaxMb(String(parsed.agents?.defaults?.mediaMaxMb ?? 5));
      setContextTokens(String(parsed.agents?.defaults?.contextTokens ?? 200000));
      setCompactionMode(parsed.agents?.defaults?.compaction?.mode || "safeguard");

      // Agent 设置
      const mainAgent = (parsed.agents?.list as AnyConfig[] | undefined)?.find(
        (a: AnyConfig) => a.id === "main",
      );
      setIdentityName(mainAgent?.identity?.name || "");
      setIdentityTheme(mainAgent?.identity?.theme || "");
      setIdentityEmoji(mainAgent?.identity?.emoji || "");
      setResponsePrefix(parsed.messages?.responsePrefix ?? "");
      setAckReaction(parsed.messages?.ackReaction ?? "");

      // 会话配置
      setDmScope(parsed.session?.dmScope || "main");
      setResetMode(parsed.session?.reset?.mode || "");
      setResetAtHour(String(parsed.session?.reset?.atHour ?? 4));
      setResetIdleMinutes(String(parsed.session?.reset?.idleMinutes ?? 60));
      setResetTriggers(parsed.session?.resetTriggers ?? ["/new", "/reset"]);

      // 日志配置
      setLogLevel(parsed.logging?.level || "info");
      setLogFile(parsed.logging?.file || "");
      setConsoleLevel(parsed.logging?.consoleLevel || "info");
      setRedactSensitive(parsed.logging?.redactSensitive || "tools");

      onConfigChange?.(checkConfigStatus(parsed));
    } catch (err) {
      console.error("读取配置失败:", err);
      onConfigChange?.({ loaded: true, hasProvider: false, hasModel: false, isComplete: false });
    } finally {
      setLoading(false);
    }
  }, [resource, onConfigChange, configPath]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // 本机 + 非 loopback 时自动检测局域网 IP
  useEffect(() => {
    if (!isRemote && gwBind !== "loopback" && !lanIp) {
      invoke<string>("get_local_lan_ip").then(setLanIp).catch(() => { });
    }
  }, [isRemote, gwBind, lanIp]);

  // ── Save ───────────────────────────────────────

  async function handleSave() {
    if (!resource) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // Build providers map from array (use auto-generated ID if user left it empty)
      const providersMap: Record<string, ProviderConfig> = {};
      for (const entry of providers) {
        const pid = entry.id || urlToProviderId(entry.config.baseUrl);
        if (pid && (entry.config.baseUrl || entry.config.apiKey)) {
          providersMap[pid] = entry.config;
        }
      }

      // 构建 gateway.auth 配置
      const gwAuthPatch: AnyConfig = { mode: gwAuthMode };
      if (gwAuthMode === "token" && gwAuthToken) {
        gwAuthPatch.token = gwAuthToken;
      }
      if (gwAuthMode === "trusted-proxy") {
        gwAuthPatch.trustedProxy = {
          userHeader: "x-forwarded-user",
        };
      }

      // 构建 allowedOrigins（所有非 loopback 场景都需要包含访问 IP）
      const gwPort = parseInt(gatewayPort, 10) || 18789;
      const allowedOrigins: string[] = [
        `http://localhost:${gwPort}`,
        `http://127.0.0.1:${gwPort}`,
      ];
      if (gwBind !== "loopback" && effectiveHost) {
        if (httpsProxyEnabled) {
          const hp = parseInt(httpsProxyPort, 10) || 18790;
          allowedOrigins.push(`https://${effectiveHost}:${hp}`);
        } else {
          allowedOrigins.push(`http://${effectiveHost}:${gwPort}`);
        }
      }

      const patch: AnyConfig = {
        gateway: {
          mode: gwMode,
          port: gwPort,
          bind: gwBind,
          auth: gwAuthPatch,
          // trusted-proxy 模式需要 trustedProxies（Caddy 从本机连接）；切换模式时显式清除
          trustedProxies: gwAuthMode === "trusted-proxy" ? ["127.0.0.1"] : null,
          controlUi: {
            enabled: gwControlUi,
            basePath: gwControlUiBasePath,
            allowedOrigins: gwBind !== "loopback" ? allowedOrigins : null,
          },
        },
        commands: {
          native: cmdNative,
          nativeSkills: cmdNativeSkills,
          ownerDisplay: cmdOwnerDisplay,
          restart: cmdRestart,
        },
        // env keys for built-in providers — 已清空的 key 显式设为 null 以通过 deep_merge 删除
        env: Object.fromEntries(
          BUILTIN_ENV_KEYS.map((def) => [def.key, envKeys[def.key] || null]),
        ),
        models: {
          mode: modelsMode,
          providers: (() => {
            // 将已删除的 provider 显式设为 null 以通过 deep_merge 从配置中移除
            const merged: Record<string, ProviderConfig | null> = {};
            for (const oldId of loadedProviderIds.current) {
              if (!providersMap[oldId]) merged[oldId] = null;
            }
            Object.assign(merged, providersMap);
            return merged;
          })(),
        },
        agents: {
          defaults: {
            model: {
              primary: primaryModel,
              fallbacks: fallbackModels.length > 0 ? fallbackModels : null,
            },
            imageModel: imageModel ? { primary: imageModel } : null,
            pdfModel: pdfModel ? { primary: pdfModel } : null,
            workspace,
            userTimezone: userTimezone || null,
            timeFormat,
            maxConcurrent: parseInt(maxConcurrent, 10) || 1,
            timeoutSeconds: parseInt(timeoutSeconds, 10) || 600,
            thinkingDefault,
            verboseDefault,
            elevatedDefault,
            mediaMaxMb: parseInt(mediaMaxMb, 10) || 5,
            contextTokens: parseInt(contextTokens, 10) || 200000,
            compaction: { mode: compactionMode },
          },
          list: (identityName || identityTheme || identityEmoji)
            ? [{
              id: "main",
              identity: {
                name: identityName || null,
                theme: identityTheme || null,
                emoji: identityEmoji || null,
              },
            }]
            : null,
        },
        messages: {
          responsePrefix: responsePrefix || null,
          ackReaction: ackReaction || null,
        },
        session: {
          dmScope,
          reset: resetMode
            ? {
              mode: resetMode,
              atHour: resetMode === "daily" ? (parseInt(resetAtHour, 10) || 4) : null,
              idleMinutes: resetMode === "idle" ? (parseInt(resetIdleMinutes, 10) || 60) : null,
            }
            : null,
          resetTriggers,
        },
        logging: {
          level: logLevel,
          file: logFile || null,
          consoleLevel,
          redactSensitive,
        },
      };

      await invoke("patch_openclaw_config", {
        ...resourceArgs(resource),
        patch: JSON.stringify(patch),
        configPath: configPath ?? undefined,
      });

      // 远程 Linux：先运行 setup-https.sh 配置 Caddy，再重启网关使配置生效
      if (isRemote) {
        // 打开日志弹窗并订阅 install:log 事件
        setDeployLogs(["[1/3] 配置已保存"]);
        setDeployStatus("running");
        setDeployOpen(true);

        const unlisten = await listen<{ line: string }>("install:log", (ev) => {
          setDeployLogs((prev) => [...prev, ev.payload.line]);
        });

        try {
          // Step 2: 配置 HTTPS 代理
          setDeployLogs((prev) => [...prev, "[2/3] 正在配置 HTTPS 代理 (Caddy)..."]);
          await invoke("setup_remote_https", {
            host: resource?.host ?? "",
            port: resource?.port ?? 22,
            username: resource?.username ?? "",
            password: resource?.password ?? "",
            httpsPort: httpsProxyPort || "18790",
          });

          // Step 3: 重启网关使配置生效
          setDeployLogs((prev) => [...prev, "[3/3] 正在重启网关使配置生效..."]);
          await invoke("gateway_control", {
            action: "restart",
            ...resourceArgs(resource),
          });

          setDeployLogs((prev) => [...prev, "✅ 全部完成：配置已保存 → HTTPS 代理已配置 → 网关已重启"]);
          setDeployStatus("success");
          setSaveMsg({ type: "ok", text: "配置已保存并生效" });
        } catch (err) {
          setDeployLogs((prev) => [...prev, `❌ 失败: ${err}`]);
          setDeployStatus("error");
          setSaveMsg({ type: "err", text: `部署失败: ${err}` });
        } finally {
          unlisten();
        }
      } else {
        // 本机安装：直接重启网关使配置生效
        try {
          await invoke("gateway_control", {
            action: "restart",
            ...resourceArgs(resource),
          });
          setSaveMsg({ type: "ok", text: "配置已保存并生效" });
        } catch {
          setSaveMsg({ type: "ok", text: "配置已保存（网关重启失败，请手动重启）" });
        }
      }

      await loadConfig();
    } catch (err) {
      setSaveMsg({ type: "err", text: `保存失败: ${err}` });
    } finally {
      setSaving(false);
    }
  }

  // ── Helpers ────────────────────────────────────

  function urlToProviderId(url: string): string {
    try { return `custom-${new URL(url).hostname.replace(/\./g, "-")}`; }
    catch { return "custom-provider"; }
  }

  function updateProvider(idx: number, patch: Partial<ProviderEntry> | { configPatch: Partial<ProviderConfig> }) {
    setProviders((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      if ("configPatch" in patch) return { ...p, config: { ...p.config, ...patch.configPatch } };
      return { ...p, ...patch };
    }));
  }

  function addProvider() {
    setProviders((prev) => [...prev, {
      id: "",
      config: { baseUrl: "", apiKey: "", api: "openai-completions", models: [] },
    }]);
  }

  function removeProvider(idx: number) {
    const entry = providers[idx];
    setProviders((prev) => prev.filter((_, i) => i !== idx));
    // Clean up model references pointing to this provider
    if (entry?.id) {
      const prefix = `${entry.id}/`;
      if (primaryModel.startsWith(prefix)) setPrimaryModel("");
      setFallbackModels((prev) => prev.filter((f) => !f.startsWith(prefix)));
      if (imageModel.startsWith(prefix)) setImageModel("");
    }
  }

  function addModelToProvider(idx: number, modelId: string, modelName: string) {
    if (!modelId.trim()) return;
    setProviders((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      return {
        ...p, config: {
          ...p.config, models: [...p.config.models, {
            id: modelId.trim(), name: modelName.trim() || modelId.trim(),
            reasoning: false, contextWindow: 128000, maxTokens: 8192,
          }]
        }
      };
    }));
  }

  function removeModelFromProvider(provIdx: number, modelId: string) {
    const entry = providers[provIdx];
    setProviders((prev) => prev.map((p, i) => {
      if (i !== provIdx) return p;
      return { ...p, config: { ...p.config, models: p.config.models.filter((m) => m.id !== modelId) } };
    }));
    if (entry?.id) {
      const fullId = `${entry.id}/${modelId}`;
      if (primaryModel === fullId) setPrimaryModel("");
      setFallbackModels((prev) => prev.filter((f) => f !== fullId));
      if (imageModel === fullId) setImageModel("");
    }
  }

  // Aggregate all selectable model options: built-in + custom providers
  const allModelOptions: { group: string; id: string; label: string }[] = [];
  for (const g of BUILTIN_MODELS) {
    for (const m of g.models) {
      allModelOptions.push({ group: g.label, id: m.id, label: m.label });
    }
  }
  for (const entry of providers) {
    const pid = entry.id || urlToProviderId(entry.config.baseUrl);
    for (const m of entry.config.models) {
      allModelOptions.push({ group: `${pid}`, id: `${pid}/${m.id}`, label: m.name || m.id });
    }
  }

  // 各 tab 必填完成状态
  const basicTabComplete = !!workspace && !!gatewayPort;
  const hasAnyEnvKey = Object.values(envKeys).some((v) => v.length > 0);
  const customProvidersComplete = providers.every((p) => !!p.config.baseUrl && !!p.config.apiKey);
  const hasApiKeyOrProvider = hasAnyEnvKey || (providers.length > 0 && providers.some((p) => !!p.config.baseUrl && !!p.config.apiKey));
  const modelTabComplete = !!primaryModel && hasApiKeyOrProvider && customProvidersComplete;
  const agentTabComplete = true;   // 无必填项
  const sessionTabComplete = true; // 无必填项
  const loggingTabComplete = true; // 无必填项
  const tabCompleteMap: Record<string, boolean> = {
    basic: basicTabComplete,
    model: modelTabComplete,
    agent: agentTabComplete,
    session: sessionTabComplete,
    logging: loggingTabComplete,
  };
  // 含必填字段的 tab
  const tabHasRequired: Record<string, boolean> = { basic: true, model: true, agent: false, session: false, logging: false };
  const isConfigComplete = basicTabComplete && modelTabComplete;

  // ── Deploy log auto-scroll ─────────────────────
  useEffect(() => {
    deployLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [deployLogs]);

  // ── Loading ────────────────────────────────────

  const containerVariants: import("framer-motion").Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } }
  };

  const itemVariants: import("framer-motion").Variants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 350, damping: 25 } }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Required warning */}
        <AnimatePresence>
          {!isConfigComplete && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 12 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="overflow-hidden shrink-0"
            >
              <div className="px-3 py-2.5 rounded-xl bg-amber-50/80 border border-amber-200/60 shadow-sm flex items-center gap-2 backdrop-blur-sm">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-[12px] text-amber-700 font-medium">
                  请完成必填项（标有 <span className="text-red-500 font-bold">*</span> 的字段）后才能保存配置并使用其他功能
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 shrink-0 p-1 bg-secondary/50 rounded-xl max-w-fit shadow-inner border border-border/40">
          {configTabs.map((tab) => {
            const complete = tabCompleteMap[tab.id] ?? true;
            const hasReq = tabHasRequired[tab.id] ?? false;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSaveMsg(null); }}
                className={cn(
                  "relative px-4 py-1.5 text-[13px] font-medium rounded-lg transition-colors flex items-center gap-1.5 z-10",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-black/5"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTabBadge"
                    className="absolute inset-0 bg-white rounded-lg shadow-sm border border-black/5 z-[-1]"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                {tab.label}
                {hasReq && !complete && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                )}
                {hasReq && complete && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" strokeWidth={2} />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto pr-2 scroll-smooth">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className="pb-6"
            >
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="show"
                className="flex flex-col gap-5"
              >
                {activeTab === "basic" && renderBasicTab()}
                {activeTab === "model" && renderModelTab()}
                {activeTab === "agent" && renderAgentTab()}
                {activeTab === "session" && renderSessionTab()}
                {activeTab === "logging" && renderLoggingTab()}
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="shrink-0 pt-3 mt-1 border-t border-border/60 flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !isConfigComplete} className="shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            保存配置
          </Button>
          {!isConfigComplete && !saving && (
            <span className="text-[11px] text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded-md border border-amber-200/50">请先完成必填项</span>
          )}
          {saveMsg && (
            <motion.span
              initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              className={cn("text-[12px] font-medium px-2 py-1 rounded-md", saveMsg.type === "ok" ? "text-green-600 bg-green-50 border border-green-200/50" : "text-red-500 bg-red-50 border border-red-200/50")}
            >
              {saveMsg.text}
            </motion.span>
          )}
        </div>
      </div>

      {/* Deploy log modal */}
      <AnimatePresence>
        {deployOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 10, opacity: 0 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="w-[560px] max-h-[70vh] bg-white rounded-2xl shadow-2xl border border-border/60 flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40 bg-muted/40 backdrop-blur-md">
                <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">
                  {deployStatus === "running" && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                  {deployStatus === "running" ? "正在部署..." : deployStatus === "success" ? "部署完成" : "部署失败"}
                </h3>
                {deployStatus !== "running" && (
                  <button
                    onClick={() => setDeployOpen(false)}
                    className="p-1 rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-5 font-mono text-[13px] leading-relaxed text-[#5a5a5a] scroll-mask-y bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]">
                {deployLogs.map((line, i) => (
                  <motion.div
                    initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}
                    key={i} className="whitespace-pre-wrap break-all mb-1"
                  >
                    {line}
                  </motion.div>
                ))}
                <div ref={deployLogEndRef} className="h-4" />
              </div>
              {deployStatus !== "running" && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "px-5 py-3.5 border-t border-border/40 flex items-center justify-between",
                    deployStatus === "success" ? "bg-green-50/50" : "bg-red-50/50"
                  )}>
                  <span className={cn("text-[13px] font-medium flex items-center gap-1.5", deployStatus === "success" ? "text-green-600" : "text-red-600")}>
                    {deployStatus === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {deployStatus === "success" ? "全部完成，配置已生效" : "部署过程中出现错误"}
                  </span>
                  <Button size="sm" variant={deployStatus === "success" ? "default" : "outline"} onClick={() => setDeployOpen(false)} className="shadow-sm">
                    关闭
                  </Button>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  // ── Tab: 基本配置 ──────────────────────────────

  function renderBasicTab() {
    return (
      <>
        {/* Card 1: 核心网络与访问 (Network & Access) */}
        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">🌐 网络与访问</h3>
            <p className="text-[12px] text-muted-foreground mt-1">配置 Gateway 的监听端口和绑定地址，控制哪些设备可以连接到你的 OpenClaw 服务。</p>
          </div>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label required>运行模式</Label>
                <Select value={gwMode} onChange={(e) => setGwMode(e.target.value)}>
                  <option value="local">local（本地运行模式）</option>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1.5">local 表示在本机运行 Gateway</p>
              </div>
              <div>
                <Label required>网关监听端口</Label>
                <Input value={gatewayPort} onChange={(e) => setGatewayPort(e.target.value)} placeholder="18789" type="number" className="text-[13px] h-9" />
                <p className="text-[11px] text-muted-foreground mt-1.5">Gateway 的 WS + HTTP 复用端口（默认 18789）</p>
              </div>
            </div>

            <div>
              <Label>绑定地址 (Bind)</Label>
              {isRemote ? (
                <>
                  <Select value="lan" disabled>
                    <option value="lan">lan（局域网公开 0.0.0.0）</option>
                  </Select>
                   <p className="text-[11px] text-muted-foreground mt-1.5">远程服务器已自动设为 lan (0.0.0.0)，允许外部设备连接</p>
                </>
              ) : (
                <>
                  <Select value={gwBind} onChange={(e) => setGwBind(e.target.value)} disabled={httpsProxyEnabled}>
                    <option value="loopback">loopback（仅本机 127.0.0.1）</option>
                    <option value="lan">lan（局域网 0.0.0.0，允许其他设备访问）</option>
                    <option value="auto">auto（自动选择）</option>
                    <option value="tailnet">tailnet（仅 Tailscale 虚拟 IP）</option>
                  </Select>
                   <p className="text-[11px] text-muted-foreground mt-1.5">仅自己使用建议选 loopback；需要手机或其他电脑访问选 lan</p>
                  {httpsProxyEnabled && (
                    <p className="text-[11px] text-yellow-600 mt-1">💡 HTTPS 代理已开启，绑定地址已被强制设为 lan</p>
                  )}
                </>
              )}
            </div>

            {/* HTTPS Proxy Configuration grouped inside network settings */}
            <div className="bg-blue-50/50 rounded-xl border border-blue-100/60 p-4 relative">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-400/5 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />
              {isRemote ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[13px] font-semibold text-blue-900">HTTPS 代理</span>
                    <CheckCircle2 className="w-4 h-4 text-green-500" strokeWidth={2} />
                  </div>
                  <div>
                    <Label className="text-blue-900">外部访问 HTTPS 端口</Label>
                    <Input value={httpsProxyPort} onChange={(e) => setHttpsProxyPort(e.target.value)} placeholder="18790" type="number" className="text-[13px] h-9 w-32 border-blue-200/60 bg-white/60 focus-visible:ring-blue-500/30 focus-visible:border-blue-500 mt-1" />
                  </div>
                </>
              ) : gwBind !== "loopback" ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-semibold text-blue-900">HTTPS 代理 (Caddy)</span>
                    <Checkbox
                      checked={httpsProxyEnabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setHttpsProxyEnabled(enabled);
                        if (enabled) {
                          setGwBind("lan");
                          setGwControlUi(true);
                        }
                      }}
                      label="启用 HTTPS 加密"
                    />
                  </div>
                  <p className="text-[11px] text-blue-700/80 mb-4 leading-relaxed">
                    绑定地址设为 lan 后，建议开启 HTTPS 代理。部分浏览器在非 HTTPS 环境下会禁用麦克风和剪贴板等功能。
                  </p>
                  {httpsProxyEnabled && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-blue-900">本机局域网 IP</Label>
                        <Input value={lanIp} onChange={(e) => setLanIp(e.target.value)} placeholder="如 192.168.1.100" className="text-[13px] h-9 border-blue-200/60 bg-white/60 focus-visible:ring-blue-500/30 focus-visible:border-blue-500 mt-1" />
                      </div>
                      <div>
                        <Label className="text-blue-900">HTTPS 对外代理端口</Label>
                        <Input value={httpsProxyPort} onChange={(e) => setHttpsProxyPort(e.target.value)} placeholder="18790" type="number" className="text-[13px] h-9 border-blue-200/60 bg-white/60 focus-visible:ring-blue-500/30 focus-visible:border-blue-500 mt-1" />
                        <p className="text-[11px] text-blue-700/70 mt-1.5">不能与 Gateway 端口相同</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[13px] font-semibold text-blue-900/60">HTTPS 代理</span>
                    <span className="px-1.5 py-0.5 rounded-[4px] bg-blue-100 text-blue-600 text-[10px] font-bold">暂不可用</span>
                  </div>
                  <p className="text-[11px] text-blue-700/60 leading-relaxed">
                    当前绑定地址为 loopback，仅本机访问无需 HTTPS。切换为 lan 后可启用。
                  </p>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-border/40">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-[13px] font-medium text-foreground block">🎨 启用 Control UI（网页控制面板）</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">提供一个可视化的网页界面，可以在浏览器中聊天、管理配置和查看会话</p>
                </div>
                <Checkbox checked={gwControlUi} onChange={(e) => setGwControlUi(e.target.checked)} />
              </div>
              {gwControlUi && (
                <div className="mt-3 pl-3 border-l-2 border-primary/20">
                  <Label>访问路径 (Base Path)</Label>
                  <Input value={gwControlUiBasePath} onChange={(e) => setGwControlUiBasePath(e.target.value)} placeholder="/openclaw" className="text-[13px] h-9 max-w-[240px] mt-1" />
                </div>
              )}
            </div>
          </div>
        </motion.section>

        {/* Card 2: 安全与认证 (Security & Authentication) */}
        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">🛡️ 接口认证 (Auth)</h3>
            <p className="text-[12px] text-muted-foreground mt-1">设置 Gateway 的访问认证方式，防止未授权的请求访问你的服务。</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label>认证方式 (Auth Mode)</Label>
              {isRemote ? (
                <>
                  <Select value={gwAuthMode} onChange={(e) => setGwAuthMode(e.target.value)} className="mt-1 max-w-[280px]">
                    <option value="token">API Token (高安全加密令牌 - 推荐)</option>
                    <option value="password">Password (传统密码校验)</option>
                  </Select>
                   <p className="text-[11px] text-muted-foreground mt-1.5">远程部署需要认证保护。推荐使用 Token 方式。</p>
                </>
              ) : (
                <>
                  <Select value={gwAuthMode} onChange={(e) => setGwAuthMode(e.target.value)} className="mt-1 max-w-[320px]">
                    <option value="token">Token（API 令牌认证，推荐）</option>
                    <option value="password">Password（密码认证）</option>
                    {gwBind === "loopback" && <option value="none">None（关闭认证，仅限 loopback）</option>}
                    {gwBind !== "loopback" && <option value="trusted-proxy">Trusted Proxy（信任前置反向代理）</option>}
                  </Select>
                  {gwAuthMode === "trusted-proxy" && (
                     <p className="text-[11px] text-amber-600 mt-1.5">⚠️ 使用 Trusted Proxy 模式时，请确保你的反向代理（如 Nginx）已正确配置身份认证</p>
                  )}
                </>
              )}
            </div>

            {gwAuthMode === "token" && (
              <div className="p-3 bg-muted/30 rounded-lg border border-border/40">
                <Label>Token 密钥</Label>
                <Input value={gwAuthToken} onChange={(e) => setGwAuthToken(e.target.value)} placeholder="留空则自动生成" type="password" className="text-[13px] h-9 mt-1.5 max-w-[320px]" />
                <p className="text-[11px] text-muted-foreground mt-1.5">留空时安装向导会自动生成一个高强度 Token</p>
              </div>
            )}
          </div>
        </motion.section>

        {/* Card 3: 运行环境参数 */}
        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">⚙️ 存储与时区</h3>
            <p className="text-[12px] text-muted-foreground mt-1">设置 Agent 的工作目录和时区偏好。</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label required>工作目录 (Workspace)</Label>
              <Input value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="~/.openclaw/workspace" className="text-[13px] h-9 mt-1" />
              <p className="text-[11px] text-muted-foreground mt-1.5">Agent 的记忆、日志、上传文件等都存放在这里</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>时区 (userTimezone)</Label>
                <Input value={userTimezone} onChange={(e) => setUserTimezone(e.target.value)} placeholder="留空将自适应系统 (如 Asia/Shanghai)" className="text-[13px] h-9 mt-1" />
                <p className="text-[11px] text-muted-foreground mt-1.5">留空则使用系统时区，也可手动指定如 Asia/Shanghai</p>
              </div>
              <div>
                <Label>时间格式 (timeFormat)</Label>
                <Select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value)} className="mt-1">
                  <option value="auto">auto（跟随系统地区）</option>
                  <option value="12">12（AM/PM 格式）</option>
                  <option value="24">24（24 小时制）</option>
                </Select>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Card 4: 开发者与高级命令 */}
        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">🛠️ 聊天命令 (Commands)</h3>
            <p className="text-[12px] text-muted-foreground mt-1">控制在 Telegram、Discord 等聊天平台中的命令菜单注册行为。</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <Label>原生命令注册 (native)</Label>
              <Select value={cmdNative} onChange={(e) => setCmdNative(e.target.value)} className="mt-1">
                <option value="auto">auto（自动判断是否注册）</option>
                <option value="true">true（强制注册）</option>
                <option value="false">false（关闭注册）</option>
              </Select>
            </div>
            <div>
              <Label>技能命令 (nativeSkills)</Label>
              <Select value={cmdNativeSkills} onChange={(e) => setCmdNativeSkills(e.target.value)} className="mt-1">
                <option value="auto">auto（自动判断）</option>
                <option value="true">true（注册技能命令）</option>
                <option value="false">false（不注册）</option>
              </Select>
            </div>
            <div>
              <Label>发送者 ID 显示格式</Label>
              <Select value={cmdOwnerDisplay} onChange={(e) => setCmdOwnerDisplay(e.target.value)} className="mt-1">
                <option value="raw">原始数字与标头表示</option>
                <option value="name">自动匹配名字与美化</option>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1.5">日志中发送者显示为原始 ID 还是可读名称</p>
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2 mt-1">
                <Checkbox checked={cmdRestart} onChange={(e) => setCmdRestart(e.target.checked)} id="chk-restart" />
                <label className="text-[13px] font-semibold text-foreground cursor-pointer select-none" htmlFor="chk-restart">允许 /restart 命令</label>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 pl-6">允许通过聊天命令重启 Gateway</p>
            </div>
          </div>
        </motion.section>
      </>
    );
  }

  // ── Tab: 模型配置 ──────────────────────────────

  function renderModelTab() {
    return (
            <div className="flex flex-col gap-5">
              {/* Card 1: 内置模型 API 密钥 (Official Keys) */}
              <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
                <div className="mb-4">
                  <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">
                    ☁️ 官方 API 密钥 (Official API Keys)
                    {!hasApiKeyOrProvider && <span className="text-red-500">*</span>}
                    {hasAnyEnvKey && <CheckCircle2 className="w-4 h-4 text-green-500" strokeWidth={2} />}
                  </h3>
                  <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                    在这里填写主流 AI 厂商的 API 密钥。这些密钥会通过 env 配置传递给 OpenClaw。
                    {!hasApiKeyOrProvider && (
                      <span className="font-medium text-red-500 block mt-1.5">
                        你至少需要填写一个 API 密钥，或在下方添加自定义提供商。
                      </span>
                    )}
                  </p>
                </div>
                <div className="space-y-2">
                  {BUILTIN_ENV_KEYS.map((def) => (
                    <div key={def.key} className="flex items-center gap-3 p-1.5 hover:bg-muted/40 rounded-xl transition-colors">
                      <span className="text-[13px] font-semibold text-foreground/80 w-28 shrink-0">{def.label}</span>
                      <Input
                        value={envKeys[def.key] || ""}
                        onChange={(e) => setEnvKeys((prev) => {
                          const next = { ...prev };
                          if (e.target.value) next[def.key] = e.target.value;
                          else delete next[def.key];
                          return next;
                        })}
                        placeholder={def.placeholder}
                        type="password"
                        className="text-[13px] h-9 flex-1 shadow-sm font-mono tracking-widest text-primary/80"
                      />
                    </div>
                  ))}
                </div>
              </motion.section>

              {/* Card 2: 自定义模型提供商 (Custom providers) */}
              <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">
                      🔌 自定义模型提供商 (Custom Providers)
                      {!hasApiKeyOrProvider && <span className="text-red-500">*</span>}
                      {!hasAnyEnvKey && providers.length > 0 && customProvidersComplete && (
                        <CheckCircle2 className="w-4 h-4 text-green-500" strokeWidth={2} />
                      )}
                    </h3>
                    <p className="text-[12px] text-muted-foreground mt-1.5 max-w-lg leading-relaxed">
                      如果你使用中转平台（如阿里百炼、OneAPI、LiteLLM）或本地模型（如 Ollama），在这里添加提供商配置。
                    </p>
                  </div>
                  <button
                    onClick={() => openUrl("https://bailian.console.aliyun.com/cn-beijing/?tab=coding-plan#/efm/index")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-100 text-blue-600 text-[12px] font-medium transition-all shadow-sm hover:shadow active:scale-95"
                  >
                  百炼<ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="mb-5 p-3 bg-muted/30 rounded-lg border border-border/40 flex items-center justify-between">
                  <div>
                    <Label className="text-[13px]">模型合并模式 (models.mode)</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">当自定义提供商的模型与内置模型重名时，如何处理</p>
                  </div>
                  <Select value={modelsMode} onChange={(e) => setModelsMode(e.target.value)} className="w-48 shadow-sm">
                    <option value="merge">merge（合并，推荐）</option>
                    <option value="replace">replace（完全替换内置列表）</option>
                  </Select>
                </div>

                <div className="space-y-4">
                  {providers.map((entry, idx) => (
                    <ProviderCard
                      key={idx}
                      entry={entry}
                      idx={idx}
                      onUpdate={updateProvider}
                      onRemove={removeProvider}
                      onAddModel={addModelToProvider}
                      onRemoveModel={removeModelFromProvider}
                      urlToProviderId={urlToProviderId}
                    />
                  ))}

                  <Button variant="outline" size="sm" onClick={addProvider} className="w-full border-dashed border-2 py-5 text-muted-foreground hover:text-foreground hover:border-primary/50 bg-transparent hover:bg-primary/5 shadow-none transition-colors duration-300">
                    <Plus className="w-4 h-4 mr-2" /> 添加自定义提供商
                  </Button>
                </div>
              </motion.section>

              {/* Card 3: 智脑驱动引擎 (Core AI Engine) */}
              <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
                <div className="mb-4">
                  <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">🧠 模型选择</h3>
                  <p className="text-[12px] text-muted-foreground mt-1">配置主模型、回退模型和专用模型。格式：provider/model-id。</p>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label required>主模型 (model.primary)</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        value={primaryModel}
                        onChange={(e) => setPrimaryModel(e.target.value)}
                        placeholder="如 anthropic/claude-sonnet-4-5"
                        className="text-[13px] h-9 flex-1 shadow-sm"
                      />
                      <ModelPickerSelect
                        options={allModelOptions}
                        exclude={[]}
                        onSelect={(id) => setPrimaryModel(id)}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">日常调用的主模型。格式：<span className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border/50 text-primary/90">provider/model-id</span></p>
                  </div>

                  <div className="p-3 bg-muted/40 rounded-xl border border-border/60">
                    <Label>回退模型 (model.fallbacks)</Label>
                    <div className="flex flex-wrap gap-1.5 mt-2 mb-2.5">
                      {fallbackModels.map((f) => (
                        <TagChip key={f} label={f} onRemove={() => setFallbackModels((prev) => prev.filter((x) => x !== f))} />
                      ))}
                      {fallbackModels.length === 0 && <span className="text-[12px] text-muted-foreground font-medium my-1">未配置回退模型</span>}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="输入模型 ID 并按回车添加"
                        className="text-[13px] h-9 flex-1 bg-background shadow-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const v = (e.target as HTMLInputElement).value.trim();
                            if (v && !fallbackModels.includes(v)) {
                              setFallbackModels((prev) => [...prev, v]);
                              (e.target as HTMLInputElement).value = "";
                            }
                          }
                        }}
                      />
                      <ModelPickerSelect
                        options={allModelOptions}
                        exclude={[primaryModel, ...fallbackModels]}
                        onSelect={(id) => {
                          if (!fallbackModels.includes(id)) setFallbackModels((prev) => [...prev, id]);
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">当主模型不可用时，系统会按顺序自动切换到回退模型，确保对话不中断。</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-3 mt-1 border-t border-border/40">
                    <div>
                      <Label>图片模型 (imageModel)</Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          value={imageModel}
                          onChange={(e) => setImageModel(e.target.value)}
                          placeholder="留白则回推缺省配置"
                          className="text-[13px] h-9 flex-1 shadow-sm"
                        />
                        <ModelPickerSelect
                          options={allModelOptions}
                          exclude={[]}
                          onSelect={(id) => setImageModel(id)}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1.5">处理图片输入时使用的模型，留空则使用主模型</p>
                    </div>
                    <div>
                      <Label>PDF 模型 (pdfModel)</Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          value={pdfModel}
                          onChange={(e) => setPdfModel(e.target.value)}
                          placeholder="留白则向图模退避转移"
                          className="text-[13px] h-9 flex-1 shadow-sm"
                        />
                        <ModelPickerSelect
                          options={allModelOptions}
                          exclude={[]}
                          onSelect={(id) => setPdfModel(id)}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1.5">处理 PDF 文档时使用的模型，留空则回退到图片模型</p>
                    </div>
                  </div>
                </div>
              </motion.section>

              {/* Card 4: 性能与运行参数 */}
              <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
                <div className="mb-4">
                  <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">⚡ 性能与运行参数</h3>
                  <p className="text-[12px] text-muted-foreground mt-1.5">高级调校参数，通常保持默认即可。</p>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                  <div>
                    <Label>会话压缩模式 (compaction)</Label>
                    <Select value={compactionMode} onChange={(e) => setCompactionMode(e.target.value)} className="mt-1 shadow-sm">
                      <option value="default">default（简单截断）</option>
                      <option value="safeguard">safeguard（分块摘要，推荐）</option>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1.5">safeguard 会在 Token 超限时智能压缩历史记录，保留核心上下文</p>
                  </div>
                  <div>
                    <Label>深度推理 (thinkingDefault)</Label>
                    <Select value={thinkingDefault} onChange={(e) => setThinkingDefault(e.target.value)} className="mt-1 shadow-sm">
                      <option value="off">off（关闭）</option>
                      <option value="low">low（低）</option>
                      <option value="medium">medium（中）</option>
                      <option value="high">high（高）</option>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1.5">适用于支持推理的模型（如 Claude 3.7、o3-mini）</p>
                  </div>
                  <div>
                    <Label>最大并发数 (maxConcurrent)</Label>
                    <Input value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} type="number" placeholder="1" className="text-[13px] h-9 mt-1 shadow-sm" />
                    <p className="text-[11px] text-muted-foreground mt-1.5">跨会话的最大并行 Agent 运行数（默认 1）</p>
                  </div>
                  <div>
                    <Label>响应超时 (timeoutSeconds)</Label>
                    <Input value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(e.target.value)} type="number" placeholder="600" className="text-[13px] h-9 mt-1 shadow-sm" />
                    <p className="text-[11px] text-muted-foreground mt-1.5">AI 响应的最大等待时间（秒，默认 600）</p>
                  </div>
                  <div>
                    <Label>上下文 Token 上限 (contextTokens)</Label>
                    <Input value={contextTokens} onChange={(e) => setContextTokens(e.target.value)} type="number" placeholder="200000" className="text-[13px] h-9 mt-1 shadow-sm" />
                    <p className="text-[11px] text-muted-foreground mt-1.5">单次会话的最大 Token 数（默认 200,000）</p>
                  </div>
                  <div>
                    <Label>媒体上传限制 (mediaMaxMb)</Label>
                    <Input value={mediaMaxMb} onChange={(e) => setMediaMaxMb(e.target.value)} type="number" placeholder="5" className="text-[13px] h-9 mt-1 shadow-sm" />
                    <p className="text-[11px] text-muted-foreground mt-1.5">单个媒体文件的最大大小（MB，默认 5）</p>
                  </div>
                  <div>
                    <Label>详细日志 (verboseDefault)</Label>
                    <Select value={verboseDefault} onChange={(e) => setVerboseDefault(e.target.value)} className="mt-1 shadow-sm">
                      <option value="off">off（关闭）</option>
                      <option value="on">on（开启详细输出）</option>
                    </Select>
                  </div>
                  <div>
                    <Label>工具提权 (elevatedDefault)</Label>
                    <Select value={elevatedDefault} onChange={(e) => setElevatedDefault(e.target.value)} className="mt-1 shadow-sm">
                      <option value="on">on（允许提权操作）</option>
                      <option value="off">off（禁止）</option>
                    </Select>
                  </div>
                </div>
              </motion.section>
      </div>
    );
  }

  // ── Tab: Agent 设置 ────────────────────────────

  function renderAgentTab() {
    return (
      <div className="flex flex-col gap-5">
        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">🤖 Agent 身份 (Identity)</h3>
            <p className="text-[12px] text-muted-foreground mt-1">设置 AI 助手的名称、风格和代表表情。</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>名称 (identity.name)</Label>
              <Input value={identityName} onChange={(e) => setIdentityName(e.target.value)} placeholder="如 Samantha" className="text-[13px] h-9 mt-1 shadow-sm" />
            </div>
            <div>
              <Label>风格主题 (identity.theme)</Label>
              <Input value={identityTheme} onChange={(e) => setIdentityTheme(e.target.value)} placeholder="如 helpful sloth" className="text-[13px] h-9 mt-1 shadow-sm" />
            </div>
            <div className="col-span-2">
              <Label>表情 (identity.emoji)</Label>
              <Input value={identityEmoji} onChange={(e) => setIdentityEmoji(e.target.value)} placeholder="如 🦥" className="text-[13px] h-9 w-24 mt-1 shadow-sm text-center" />
            </div>
          </div>
        </motion.section>

        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">💬 消息显示 (Messages)</h3>
            <p className="text-[12px] text-muted-foreground mt-1">设置 AI 回复时的前缀和确认反应。</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>回复前缀 (responsePrefix)</Label>
              <Input value={responsePrefix} onChange={(e) => setResponsePrefix(e.target.value)} placeholder="默认 🦞" className="text-[13px] h-9 mt-1 shadow-sm w-32" />
              <p className="text-[11px] text-muted-foreground mt-1.5">每条回复前的标识符，如 🧡 或 [AI]</p>
            </div>
            <div>
              <Label>确认反应 (ackReaction)</Label>
              <Input value={ackReaction} onChange={(e) => setAckReaction(e.target.value)} placeholder="默认 👀" className="text-[13px] h-9 mt-1 shadow-sm w-32" />
              <p className="text-[11px] text-muted-foreground mt-1.5">收到消息后立即给出的表情反应，默认为 identity.emoji 或 👀</p>
            </div>
          </div>
        </motion.section>
      </div>
    );
  }

  // ── Tab: 会话配置 ──────────────────────────────

  function renderSessionTab() {
    return (
      <div className="flex flex-col gap-5">
        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">🔒 会话隔离 (Session Scope)</h3>
            <p className="text-[12px] text-muted-foreground mt-1">控制不同用户的对话如何隔离，防止记忆串台。</p>
          </div>
          <div>
            <Label className="text-[13px]">会话隔离策略 (dmScope)</Label>
            <Select value={dmScope} onChange={(e) => setDmScope(e.target.value)} className="mt-1 shadow-sm">
              <option value="main">main（所有用户共享一个会话）</option>
              <option value="per-peer">per-peer（按发送者隔离）</option>
              <option value="per-channel-peer">per-channel-peer（按渠道+发送者隔离，推荐）</option>
              <option value="per-account-channel-peer">per-account-channel-peer（最严格隔离）</option>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1.5">个人使用选 main；多人共享建议选 per-channel-peer 或更高级别</p>
          </div>
        </motion.section>

        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">⏰ 会话重置 (Session Reset)</h3>
            <p className="text-[12px] text-muted-foreground mt-1">配置自动清空对话历史的规则，或通过命令手动重置。</p>
          </div>

          <div className="p-3 bg-muted/30 border border-border/40 rounded-xl mb-4">
            <Label className="text-[13px]">自动重置模式 (reset.mode)</Label>
            <Select value={resetMode} onChange={(e) => setResetMode(e.target.value)} className="mt-1 shadow-sm">
              <option value="">不自动重置</option>
              <option value="daily">daily（每天定时重置）</option>
              <option value="idle">idle（空闲超时后重置）</option>
            </Select>

            {resetMode === "daily" && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <Label>重置时间（小时，0-23）</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input value={resetAtHour} onChange={(e) => setResetAtHour(e.target.value)} type="number" min={0} max={23} placeholder="4" className="text-[13px] h-9 w-24 shadow-sm" />
                  <span className="text-[12px] text-muted-foreground font-medium">点时执行重置</span>
                </div>
              </div>
            )}
            {resetMode === "idle" && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <Label>空闲超时（分钟）</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input value={resetIdleMinutes} onChange={(e) => setResetIdleMinutes(e.target.value)} type="number" placeholder="60" className="text-[13px] h-9 w-24 shadow-sm" />
                  <span className="text-[12px] text-muted-foreground font-medium">分钟无互动则自动重置</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label className="text-[13px]">手动重置触发词 (resetTriggers)</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5 mb-2.5">
              {resetTriggers.map((t) => (
                <TagChip key={t} label={t} onRemove={() => setResetTriggers((prev) => prev.filter((x) => x !== t))} />
              ))}
              {resetTriggers.length === 0 && <span className="text-[12px] text-muted-foreground py-0.5 font-medium">未配置触发词</span>}
            </div>
            <div className="flex gap-2">
              <Input
                value={newResetTrigger}
                onChange={(e) => setNewResetTrigger(e.target.value)}
                placeholder="如 /clear，键入 Enter 立即录入"
                className="text-[13px] h-9 flex-1 shadow-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = newResetTrigger.trim();
                    if (v && !resetTriggers.includes(v)) {
                      setResetTriggers((prev) => [...prev, v]);
                      setNewResetTrigger("");
                    }
                  }
                }}
              />
              <Button variant="outline" size="sm" onClick={() => {
                const v = newResetTrigger.trim();
                if (v && !resetTriggers.includes(v)) {
                  setResetTriggers((prev) => [...prev, v]);
                  setNewResetTrigger("");
                }
              }} disabled={!newResetTrigger.trim()} className="h-9 px-4 shadow-sm">
                <Plus className="w-4 h-4 mr-1.5" /> 添加
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">发送这些命令会清空当前会话历史，开始全新对话。建议添加 "/new" 或 "/reset"</p>
          </div>
        </motion.section>
      </div>
    );
  }

  // ── Tab: 日志配置 ──────────────────────────────

  function renderLoggingTab() {
    return (
      <div className="flex flex-col gap-5">
        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">📋 日志配置 (Logging)</h3>
            <p className="text-[12px] text-muted-foreground mt-1">控制控制台和文件日志的输出级别与存储位置。</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>控制台日志级别 (consoleLevel)</Label>
              <Select value={consoleLevel} onChange={(e) => setConsoleLevel(e.target.value)} className="mt-1 shadow-sm">
                <option value="debug">debug（详细调试信息）</option>
                <option value="info">info（常规信息，默认）</option>
                <option value="warn">warn（仅警告）</option>
                <option value="error">error（仅错误）</option>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1.5">默认 info。使用 CLI --verbose 开关时会强制切换到 debug</p>
            </div>
            <div>
              <Label>文件日志级别 (logging.level)</Label>
              <Select value={logLevel} onChange={(e) => setLogLevel(e.target.value)} className="mt-1 shadow-sm">
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1.5">写入日志文件的记录级别</p>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-border/40">
            <Label>日志文件路径 (logging.file)</Label>
            <Input value={logFile} onChange={(e) => setLogFile(e.target.value)} placeholder="留空则使用默认路径: /tmp/openclaw/openclaw-YYYY-MM-DD.log" className="text-[13px] h-9 mt-1 shadow-sm font-mono tracking-tight" />
          </div>
        </motion.section>

        <motion.section variants={itemVariants} className="p-5 bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm rounded-2xl card-hover relative overflow-hidden group">
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">🛡️ 敏感信息脱敏 (Redact)</h3>
            <p className="text-[12px] text-muted-foreground mt-1">防止日志中泄露 API 密钥、密码等敏感信息。</p>
          </div>
          <Label>脱敏模式 (redactSensitive)</Label>
          <Select value={redactSensitive} onChange={(e) => setRedactSensitive(e.target.value)} className="mt-1 max-w-sm shadow-sm">
            <option value="off">off（不脱敏）</option>
            <option value="tools">tools（脱敏工具返回的敏感内容）</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed max-w-xl">开启 tools 后，系统会自动检测并将日志中可能包含密钥的内容替换为 ***。生产环境建议开启。</p>
        </motion.section>
      </div>
    );
  }
}

// ── Shared sub-component ─────────────────────────

function TagChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 text-[12px] font-medium transition-colors">
      {label}
      <button onClick={onRemove} className="hover:opacity-70"><X className="w-3 h-3" /></button>
    </span>
  );
}

// ── Model picker select with grouped options ─────

interface ModelPickerSelectProps {
  options: { group: string; id: string; label: string }[];
  exclude: string[];
  onSelect: (id: string) => void;
}

function ModelPickerSelect({ options, exclude, onSelect }: ModelPickerSelectProps) {
  const filtered = options.filter((o) => !exclude.includes(o.id));
  if (filtered.length === 0) return null;

  // Group by provider
  const groups = new Map<string, { id: string; label: string }[]>();
  for (const o of filtered) {
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group)!.push({ id: o.id, label: o.label });
  }

  return (
    <Select
      value=""
      onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}
      className="w-44 shrink-0"
    >
      <option value="">快速选择...</option>
      {[...groups.entries()].map(([group, models]) => (
        <optgroup key={group} label={group}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

// ── Provider card sub-component ──────────────────

interface ProviderCardProps {
  entry: ProviderEntry;
  idx: number;
  onUpdate: (idx: number, patch: Partial<ProviderEntry> | { configPatch: Partial<ProviderConfig> }) => void;
  onRemove: (idx: number) => void;
  onAddModel: (idx: number, modelId: string, modelName: string) => void;
  onRemoveModel: (provIdx: number, modelId: string) => void;
  urlToProviderId: (url: string) => string;
}

function ProviderCard({ entry, idx, onUpdate, onRemove, onAddModel, onRemoveModel, urlToProviderId }: ProviderCardProps) {
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const pid = entry.id || urlToProviderId(entry.config.baseUrl);
  const hasContent = !!(entry.config.baseUrl || entry.config.apiKey);

  return (
    <div className="mb-4 rounded-lg border border-border/60 bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30 rounded-t-lg">
        <span className="text-[13px] font-medium text-foreground flex-1">
          {entry.id || pid || `提供商 ${idx + 1}`}
        </span>
        <button onClick={() => onRemove(idx)} className="text-muted-foreground hover:text-red-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <Label>提供商 ID</Label>
          <Input
            value={entry.id}
            onChange={(e) => onUpdate(idx, { id: e.target.value })}
            placeholder={urlToProviderId(entry.config.baseUrl) || "如 my-proxy"}
            className="text-[13px] h-9"
          />
          <p className="text-[11px] text-muted-foreground mt-1">模型引用格式为 <span className="font-mono">{pid}/模型ID</span>，留空自动生成</p>
        </div>
        <div>
          <Label required={hasContent}>API 地址</Label>
          <Input
            value={entry.config.baseUrl}
            onChange={(e) => onUpdate(idx, { configPatch: { baseUrl: e.target.value } })}
            placeholder="https://api.example.com/v1"
            className="text-[13px] h-9"
          />
        </div>
        <div>
          <Label required={hasContent}>API 密钥</Label>
          <Input
            value={entry.config.apiKey}
            onChange={(e) => onUpdate(idx, { configPatch: { apiKey: e.target.value } })}
            placeholder="sk-..."
            type="password"
            className="text-[13px] h-9"
          />
        </div>
        <div>
          <Label>接口协议</Label>
          <Select
            value={entry.config.api || "openai-completions"}
            onChange={(e) => onUpdate(idx, { configPatch: { api: e.target.value } })}
          >
            <option value="openai-completions">openai-completions（兼容 OpenAI Chat）</option>
            <option value="openai-responses">openai-responses（OpenAI Responses API）</option>
            <option value="anthropic-messages">anthropic-messages（兼容 Anthropic）</option>
            <option value="google-generative-ai">google-generative-ai（Google Gemini）</option>
          </Select>
        </div>

        {/* Model list for this provider */}
        <div>
          <Label>提供商模型列表</Label>
          <div className="space-y-1.5 mt-1">
            {entry.config.models.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border/40 bg-muted/20 text-[13px]">
                <span className="flex-1 truncate text-foreground">{m.name || m.id}</span>
                <span className="text-[11px] text-muted-foreground shrink-0 font-mono">{pid}/{m.id}</span>
                <button onClick={() => onRemoveModel(idx, m.id)} className="text-muted-foreground hover:text-red-400 transition-colors shrink-0">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="模型 ID"
                className="text-[13px] h-8 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newModelId.trim()) {
                    onAddModel(idx, newModelId, newModelName);
                    setNewModelId(""); setNewModelName("");
                  }
                }}
              />
              <Input
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="显示名称（可选）"
                className="text-[13px] h-8 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newModelId.trim()) {
                    onAddModel(idx, newModelId, newModelName);
                    setNewModelId(""); setNewModelName("");
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onAddModel(idx, newModelId, newModelName);
                  setNewModelId(""); setNewModelName("");
                }}
                disabled={!newModelId.trim()}
                className="h-8 px-2"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

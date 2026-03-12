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

  // ── Load config ────────────────────────────────

  const loadConfig = useCallback(async () => {
    if (!resource) return;
    setLoading(true);
    try {
      const raw = await invoke<string>("read_openclaw_config", {
        target: resource.type,
        host: resource.host ?? null,
        port: resource.port ?? null,
        username: resource.username ?? null,
        password: resource.password ?? null,
        config_path: configPath ?? undefined,
      });
      const parsed: AnyConfig = JSON.parse(raw);

      // 基本配置 —— 优先使用服务端实际值，仅在字段未设置时应用默认值
      const isRemoteRes = resource.type === "remote";
      const gw = parsed.gateway ?? {};
      const gwAuth = gw.auth ?? {};
      const gwCui = gw.controlUi ?? {};

      setGwMode(gw.mode || "local");
      setGatewayPort(String(gw.port ?? 18789));

      // bind: 有值用实际值；未设置时远程默认 lan，本机默认 loopback
      const bindHasValue = gw.bind !== undefined && gw.bind !== null;
      setGwBind(bindHasValue ? gw.bind : (isRemoteRes ? "lan" : "loopback"));

      setGwAuthToken(gwAuth.token || "");
      setWorkspace(parsed.agents?.defaults?.workspace || "~/.openclaw/workspace");
      setUserTimezone(parsed.agents?.defaults?.userTimezone || "");
      setTimeFormat(parsed.agents?.defaults?.timeFormat || "auto");
      setGwControlUi(gwCui.enabled !== false);
      setGwControlUiBasePath(gwCui.basePath || "/openclaw");

      // HTTPS 代理 & 认证模式 —— 读取实际配置
      const authModeHasValue = gwAuth.mode !== undefined && gwAuth.mode !== null;
      const isTrustedProxy = gwAuth.mode === "trusted-proxy";

      if (authModeHasValue) {
        // 用户已配置过认证模式 → 原样展示
        setGwAuthMode(gwAuth.mode);
        setHttpsProxyEnabled(isTrustedProxy);
      } else {
        // 首次（未配置）→ 远程默认开启 HTTPS 代理 + trusted-proxy；本机默认 token
        if (isRemoteRes) {
          setGwAuthMode("trusted-proxy");
          setHttpsProxyEnabled(true);
        } else {
          setGwAuthMode("token");
          setHttpsProxyEnabled(false);
        }
      }

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
  }, [resource, onConfigChange]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // 本机 + 非 loopback 时自动检测局域网 IP
  useEffect(() => {
    if (!isRemote && gwBind !== "loopback" && !lanIp) {
      invoke<string>("get_local_lan_ip").then(setLanIp).catch(() => {});
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
        gwAuthPatch.trustedProxy = { userHeader: "x-forwarded-user" };
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
          // trusted-proxy 模式需要 trustedProxies（Caddy 从本机连接）
          ...(gwAuthMode === "trusted-proxy" ? { trustedProxies: ["127.0.0.1"] } : {}),
          controlUi: {
            enabled: gwControlUi,
            basePath: gwControlUiBasePath,
            ...(gwBind !== "loopback" ? { allowedOrigins } : {}),
          },
        },
        commands: {
          native: cmdNative,
          nativeSkills: cmdNativeSkills,
          ownerDisplay: cmdOwnerDisplay,
          restart: cmdRestart,
        },
        // env keys for built-in providers
        ...(Object.keys(envKeys).length > 0 ? {
          env: Object.fromEntries(
            Object.entries(envKeys).filter(([, v]) => v.length > 0),
          ),
        } : {}),
        models: {
          mode: modelsMode,
          ...(Object.keys(providersMap).length > 0 ? { providers: providersMap } : {}),
        },
        agents: {
          defaults: {
            model: {
              primary: primaryModel,
              ...(fallbackModels.length > 0 ? { fallbacks: fallbackModels } : {}),
            },
            ...(imageModel ? { imageModel: { primary: imageModel } } : {}),
            ...(pdfModel ? { pdfModel: { primary: pdfModel } } : {}),
            workspace,
            ...(userTimezone ? { userTimezone } : {}),
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
          ...(identityName || identityTheme || identityEmoji ? {
            list: [{
              id: "main",
              identity: {
                ...(identityName ? { name: identityName } : {}),
                ...(identityTheme ? { theme: identityTheme } : {}),
                ...(identityEmoji ? { emoji: identityEmoji } : {}),
              },
            }],
          } : {}),
        },
        ...(responsePrefix || ackReaction ? {
          messages: {
            ...(responsePrefix ? { responsePrefix } : {}),
            ...(ackReaction ? { ackReaction } : {}),
          },
        } : {}),
        session: {
          dmScope,
          ...(resetMode ? {
            reset: {
              mode: resetMode,
              ...(resetMode === "daily" ? { atHour: parseInt(resetAtHour, 10) || 4 } : {}),
              ...(resetMode === "idle" ? { idleMinutes: parseInt(resetIdleMinutes, 10) || 60 } : {}),
            },
          } : {}),
          resetTriggers,
        },
        logging: {
          level: logLevel,
          ...(logFile ? { file: logFile } : {}),
          consoleLevel,
          redactSensitive,
        },
      };

      await invoke("patch_openclaw_config", {
        target: resource.type,
        host: resource.host ?? null,
        port: resource.port ?? null,
        username: resource.username ?? null,
        password: resource.password ?? null,
        patch: JSON.stringify(patch),
        config_path: configPath ?? undefined,
      });

      setSaveMsg({ type: "ok", text: "配置已保存" });
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
      return { ...p, config: { ...p.config, models: [...p.config.models, {
        id: modelId.trim(), name: modelName.trim() || modelId.trim(),
        reasoning: false, contextWindow: 128000, maxTokens: 8192,
      }] } };
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

  // Control UI 动态 IP（用于非 HTTPS 场景的 URL 展示）
  const controlUiHost = (() => {
    if (resource?.type === "remote" && resource.host) return resource.host;
    if (gwBind !== "loopback" && lanIp) return lanIp;
    return "127.0.0.1";
  })();

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
      {/* Required warning */}
      {!isConfigComplete && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-[12px] text-amber-700">
            请完成必填项（标有 <span className="text-red-500 font-bold">*</span> 的字段）后才能保存配置并使用其他功能
          </span>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 shrink-0 border-b border-border/40 pb-px">
        {configTabs.map((tab) => {
          const complete = tabCompleteMap[tab.id] ?? true;
          const hasReq = tabHasRequired[tab.id] ?? false;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSaveMsg(null); }}
              className={cn(
                "px-3 py-1.5 text-[13px] font-medium rounded-t-lg transition-colors -mb-px flex items-center gap-1.5",
                activeTab === tab.id
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
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
      <div className="flex-1 overflow-auto space-y-5 pr-1">
        {activeTab === "basic" && renderBasicTab()}
        {activeTab === "model" && renderModelTab()}
        {activeTab === "agent" && renderAgentTab()}
        {activeTab === "session" && renderSessionTab()}
        {activeTab === "logging" && renderLoggingTab()}
      </div>

      {/* Footer */}
      <div className="shrink-0 pt-3 mt-3 border-t border-border/60 flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || !isConfigComplete}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          保存配置
        </Button>
        {!isConfigComplete && !saving && (
          <span className="text-[11px] text-amber-600">请先完成必填项</span>
        )}
        {saveMsg && (
          <span className={cn("text-[12px]", saveMsg.type === "ok" ? "text-green-500" : "text-red-400")}>
            {saveMsg.text}
          </span>
        )}
      </div>
    </div>
  );

  // ── Tab: 基本配置 ──────────────────────────────

  function renderBasicTab() {
    return (
      <>
        <section>
          <Label required>运行模式</Label>
          <Select value={gwMode} onChange={(e) => setGwMode(e.target.value)}>
            <option value="local">local（本地运行）</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 local</p>
        </section>

        <section>
          <Label required>网关端口</Label>
          <Input value={gatewayPort} onChange={(e) => setGatewayPort(e.target.value)} placeholder="18789" type="number" className="text-[13px] h-9 w-32" />
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 18789</p>
        </section>

        <section>
          <Label>网关绑定地址</Label>
          <Select value={gwBind} onChange={(e) => setGwBind(e.target.value)} disabled={httpsProxyEnabled}>
            {!isRemote && <option value="loopback">loopback（仅本机 127.0.0.1）</option>}
            <option value="lan">lan（局域网 0.0.0.0）</option>
            <option value="auto">auto（自动）</option>
            <option value="tailnet">tailnet（仅 Tailscale IP）</option>
          </Select>
          {isRemote && (
            <p className="text-[11px] text-muted-foreground mt-1.5">远程 Linux 需要绑定局域网地址才能通过 IP 访问</p>
          )}
          {!isRemote && (
            <p className="text-[11px] text-muted-foreground mt-1.5">默认 loopback</p>
          )}
          {httpsProxyEnabled && (
            <p className="text-[11px] text-yellow-600 mt-1">HTTPS 代理已开启，绑定地址自动设为 lan</p>
          )}
        </section>

        <section>
          <Label>认证模式</Label>
          <Select value={gwAuthMode} onChange={(e) => setGwAuthMode(e.target.value)} disabled={httpsProxyEnabled}>
            <option value="token">token（Token 认证）</option>
            <option value="password">password（密码认证）</option>
            {gwBind === "loopback" && <option value="none">none（无认证，仅限本机）</option>}
            {gwBind !== "loopback" && <option value="trusted-proxy">trusted-proxy（反向代理认证）</option>}
          </Select>
          {gwAuthMode === "token" && (
            <div className="mt-3">
              <Label>认证 Token</Label>
              <Input value={gwAuthToken} onChange={(e) => setGwAuthToken(e.target.value)} placeholder="留空使用自动生成的 token" type="password" className="text-[13px] h-9" />
            </div>
          )}
          {gwAuthMode === "trusted-proxy" && (
            <p className="text-[11px] text-muted-foreground mt-1.5">由 HTTPS 反向代理（Caddy）处理认证，无需 Token 或密码</p>
          )}
          {gwAuthMode !== "trusted-proxy" && (
            <p className="text-[11px] text-muted-foreground mt-1.5">默认 token，安装向导自动生成</p>
          )}
          {httpsProxyEnabled && (
            <p className="text-[11px] text-yellow-600 mt-1">HTTPS 代理已开启，认证模式自动设为 trusted-proxy</p>
          )}
        </section>

        <section>
          <Label required>工作目录</Label>
          <Input value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="~/.openclaw/workspace" className="text-[13px] h-9" />
          <p className="text-[11px] text-muted-foreground mt-1.5">Agent 文件存储目录，默认 ~/.openclaw/workspace</p>
        </section>

        <section>
          <Label>用户时区</Label>
          <Input value={userTimezone} onChange={(e) => setUserTimezone(e.target.value)} placeholder="跟随系统（如 Asia/Shanghai）" className="text-[13px] h-9" />
          <p className="text-[11px] text-muted-foreground mt-1.5">留空则跟随系统时区</p>
        </section>

        <section>
          <Label>时间格式</Label>
          <Select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value)}>
            <option value="auto">auto（自动）</option>
            <option value="12">12（12 小时制）</option>
            <option value="24">24（24 小时制）</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 auto</p>
        </section>

        {/* HTTPS 代理：bind 非 loopback 时显示（局域网访问需要 HTTPS 安全上下文） */}
        {gwBind !== "loopback" && (
          <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
            <h3 className="text-[13px] font-semibold text-foreground mb-2">HTTPS 代理（Caddy）</h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              {isRemote
                ? "远程 Linux 服务器需要 HTTPS 代理才能从浏览器访问 Control UI"
                : "绑定局域网后，从其他设备通过 IP 访问需要 HTTPS（浏览器安全上下文要求）"}
            </p>
            <Checkbox
              checked={httpsProxyEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setHttpsProxyEnabled(enabled);
                if (enabled) {
                  setGwBind("lan");
                  setGwAuthMode("trusted-proxy");
                  setGwControlUi(true);
                }
              }}
              label="启用 HTTPS 代理"
            />
            {httpsProxyEnabled && (
              <div className="mt-3 space-y-3">
                {!isRemote && (
                  <div>
                    <Label>本机局域网 IP</Label>
                    <Input value={lanIp} onChange={(e) => setLanIp(e.target.value)} placeholder="如 192.168.1.100" className="text-[13px] h-9 w-48" />
                    <p className="text-[11px] text-muted-foreground mt-1">自动检测，也可手动修改</p>
                  </div>
                )}
                <div>
                  <Label>HTTPS 对外端口</Label>
                  <Input value={httpsProxyPort} onChange={(e) => setHttpsProxyPort(e.target.value)} placeholder="18790" type="number" className="text-[13px] h-9 w-32" />
                  <p className="text-[11px] text-muted-foreground mt-1">浏览器访问端口，需与 OpenClaw 网关端口不同</p>
                </div>
                {effectiveHost && (
                  <p className="text-[11px] text-blue-600">
                    访问地址：<span className="font-mono">https://{effectiveHost}:{httpsProxyPort}{gwControlUiBasePath}</span>
                  </p>
                )}
                {!isRemote && (
                  <p className="text-[11px] text-yellow-600">
                    本机需手动安装 Caddy 并配置反向代理，远程 Linux 可自动配置
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <section>
          <Label className="mb-2">控制面板</Label>
          <Checkbox
            checked={gwControlUi}
            onChange={(e) => setGwControlUi(e.target.checked)}
            label="启用 Control UI 控制面板"
          />
          {gwControlUi && (
            <div className="mt-3">
              <Label>Control UI 路径</Label>
              <Input value={gwControlUiBasePath} onChange={(e) => setGwControlUiBasePath(e.target.value)} placeholder="/openclaw" className="text-[13px] h-9 w-48" />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-1.5">
            启用后可通过{" "}
            <span className="font-mono text-foreground">
              {httpsProxyEnabled && effectiveHost
                ? `https://${effectiveHost}:${httpsProxyPort}${gwControlUiBasePath}`
                : `http://${controlUiHost}:${gatewayPort}${gwControlUiBasePath}`}
            </span>
            {" "}访问
          </p>
        </section>

        <section>
          <h3 className="text-[13px] font-semibold text-foreground mb-3">命令配置</h3>
          <div className="space-y-3">
            <div>
              <Label>原生命令</Label>
              <Select value={cmdNative} onChange={(e) => setCmdNative(e.target.value)}>
                <option value="auto">auto（自动检测）</option>
                <option value="true">true（启用）</option>
                <option value="false">false（禁用）</option>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">默认 auto，控制是否注册原生平台命令</p>
            </div>
            <div>
              <Label>原生技能命令</Label>
              <Select value={cmdNativeSkills} onChange={(e) => setCmdNativeSkills(e.target.value)}>
                <option value="auto">auto（自动检测）</option>
                <option value="true">true（启用）</option>
                <option value="false">false（禁用）</option>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">默认 auto，控制是否注册原生技能命令</p>
            </div>
            <div>
              <Label>所有者显示格式</Label>
              <Select value={cmdOwnerDisplay} onChange={(e) => setCmdOwnerDisplay(e.target.value)}>
                <option value="raw">raw（原始格式）</option>
                <option value="name">name（显示名称）</option>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">默认 raw</p>
            </div>
            <div>
              <Checkbox
                checked={cmdRestart}
                onChange={(e) => setCmdRestart(e.target.checked)}
                label="允许重启命令"
              />
              <p className="text-[11px] text-muted-foreground mt-1">默认关闭，启用后允许 /restart 命令和网关重启工具</p>
            </div>
          </div>
        </section>
      </>
    );
  }

  // ── Tab: 模型配置 ──────────────────────────────

  function renderModelTab() {
    return (
      <>
        {/* 模型合并模式 */}
        <section>
          <Label>模型目录模式</Label>
          <Select value={modelsMode} onChange={(e) => setModelsMode(e.target.value)}>
            <option value="merge">merge（合并，默认）</option>
            <option value="replace">replace（完全替换）</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">merge 将自定义提供商与内置目录合并；replace 完全使用自定义配置</p>
        </section>

        {/* ── 内置模型 API 密钥 ── */}
        <section>
          <h3 className="text-[13px] font-semibold text-foreground mb-1 flex items-center gap-1">
            内置模型 API 密钥
            {!hasApiKeyOrProvider && <span className="text-red-500">*</span>}
            {hasAnyEnvKey && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-1" strokeWidth={2} />}
          </h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            使用 OpenClaw 内置模型供应商时，在此填写对应的 API Key。
            {!hasApiKeyOrProvider && (
              <span className="font-medium text-red-500">
                至少填写一个 API Key 或在下方配置一个自定义提供商（二选一）。
              </span>
            )}
          </p>
          <div className="space-y-2.5">
            {BUILTIN_ENV_KEYS.map((def) => (
              <div key={def.key} className="flex items-center gap-2">
                <span className="text-[13px] text-foreground w-28 shrink-0">{def.label}</span>
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
                  className="text-[13px] h-8 flex-1"
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            密钥保存在配置文件的 <span className="font-mono">env</span> 字段中，如 <span className="font-mono">ANTHROPIC_API_KEY</span>、<span className="font-mono">OPENAI_API_KEY</span> 等。
          </p>
        </section>

        {/* ── 模型选择 ── */}
        <section>
          <h3 className="text-[13px] font-semibold text-foreground mb-3">模型选择</h3>
          <div className="space-y-3">
            <div>
              <Label required>主模型</Label>
              <div className="flex gap-2">
                <Input
                  value={primaryModel}
                  onChange={(e) => setPrimaryModel(e.target.value)}
                  placeholder="如 anthropic/claude-sonnet-4-5"
                  className="text-[13px] h-9 flex-1"
                />
                <ModelPickerSelect
                  options={allModelOptions}
                  exclude={[]}
                  onSelect={(id) => setPrimaryModel(id)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                格式：<span className="font-mono">provider/model-id</span>。
                内置模型（anthropic、openai 等）可直接填写或从右侧选择，自定义提供商的模型需先在下方配置。
              </p>
            </div>
            <div>
              <Label>备用模型</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {fallbackModels.map((f) => (
                  <TagChip key={f} label={f} onRemove={() => setFallbackModels((prev) => prev.filter((x) => x !== f))} />
                ))}
                {fallbackModels.length === 0 && <span className="text-[12px] text-muted-foreground">未配置</span>}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="输入备用模型 ID 后回车添加"
                  className="text-[13px] h-9 flex-1"
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
              <p className="text-[11px] text-muted-foreground mt-1">主模型不可用时按顺序切换</p>
            </div>
            <div>
              <Label>图片模型</Label>
              <div className="flex gap-2">
                <Input
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                  placeholder="如 openrouter/qwen/qwen-2.5-vl-72b-instruct:free"
                  className="text-[13px] h-9 flex-1"
                />
                <ModelPickerSelect
                  options={allModelOptions}
                  exclude={[]}
                  onSelect={(id) => setImageModel(id)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">用于图片处理，留空使用默认</p>
            </div>
            <div>
              <Label>PDF 模型</Label>
              <div className="flex gap-2">
                <Input
                  value={pdfModel}
                  onChange={(e) => setPdfModel(e.target.value)}
                  placeholder="如 anthropic/claude-opus-4-6"
                  className="text-[13px] h-9 flex-1"
                />
                <ModelPickerSelect
                  options={allModelOptions}
                  exclude={[]}
                  onSelect={(id) => setPdfModel(id)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">用于 PDF 文档处理，留空则依次回退到图片模型、供应商默认</p>
            </div>
          </div>
        </section>

        {/* ── 自定义模型提供商（可选，支持多个）── */}
        <section>
          <h3 className="text-[13px] font-semibold text-foreground mb-1 flex items-center gap-2">
            自定义模型提供商
            {!hasApiKeyOrProvider && <span className="text-red-500 text-[13px]">*</span>}
            {!hasAnyEnvKey && providers.length > 0 && customProvidersComplete && (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" strokeWidth={2} />
            )}
            <span className="text-[11px] font-normal text-muted-foreground">
              {hasAnyEnvKey ? "（可选，使用第三方 API 时填写）" : "（未填写内置 API 密钥时必须配置）"}
            </span>
            <button
              onClick={() => openUrl("https://bailian.console.aliyun.com/cn-beijing/?tab=coding-plan#/efm/index")}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-500 text-[11px] font-medium transition-colors"
            >
              百炼 <ExternalLink className="w-3 h-3" />
            </button>
          </h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            使用 OpenClaw 内置模型（anthropic、openai、google、openrouter、groq、minimax、zai、moonshot、qwen 等）无需配置此项，直接在上方填写模型 ID 即可。
            仅在使用第三方 API 或自建代理时添加自定义提供商。
            {!hasApiKeyOrProvider && (
              <span className="font-medium text-red-500">
                与上方内置 API 密钥二选一，至少完成一项。
              </span>
            )}
          </p>

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

          <Button variant="outline" size="sm" onClick={addProvider} className="mt-2">
            <Plus className="w-3.5 h-3.5 mr-1" /> 添加自定义提供商
          </Button>
        </section>

        {/* 运行参数 */}
        <section>
          <h3 className="text-[13px] font-semibold text-foreground mb-3">运行参数</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>最大并发数</Label>
              <Input value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} type="number" placeholder="1" className="text-[13px] h-9" />
            </div>
            <div>
              <Label>超时时间（秒）</Label>
              <Input value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(e.target.value)} type="number" placeholder="600" className="text-[13px] h-9" />
            </div>
            <div>
              <Label>思考模式</Label>
              <Select value={thinkingDefault} onChange={(e) => setThinkingDefault(e.target.value)}>
                <option value="off">off（关闭）</option>
                <option value="low">low（低）</option>
                <option value="medium">medium（中）</option>
                <option value="high">high（高）</option>
              </Select>
            </div>
            <div>
              <Label>上下文 Token 上限</Label>
              <Input value={contextTokens} onChange={(e) => setContextTokens(e.target.value)} type="number" placeholder="200000" className="text-[13px] h-9" />
            </div>
            <div>
              <Label>详细输出</Label>
              <Select value={verboseDefault} onChange={(e) => setVerboseDefault(e.target.value)}>
                <option value="off">off（关闭）</option>
                <option value="on">on（开启）</option>
              </Select>
            </div>
            <div>
              <Label>提权工具</Label>
              <Select value={elevatedDefault} onChange={(e) => setElevatedDefault(e.target.value)}>
                <option value="on">on（允许）</option>
                <option value="off">off（禁用）</option>
              </Select>
            </div>
            <div>
              <Label>媒体大小上限（MB）</Label>
              <Input value={mediaMaxMb} onChange={(e) => setMediaMaxMb(e.target.value)} type="number" placeholder="5" className="text-[13px] h-9" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">并发默认 1，超时默认 600s，思考默认 low，上下文默认 200000，媒体默认 5MB</p>
        </section>

        {/* 压缩策略 */}
        <section>
          <Label>会话压缩模式</Label>
          <Select value={compactionMode} onChange={(e) => setCompactionMode(e.target.value)}>
            <option value="default">default（默认压缩）</option>
            <option value="safeguard">safeguard（分块摘要，防止信息丢失）</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 safeguard，对长对话进行分块摘要以保留关键信息</p>
        </section>
      </>
    );
  }

  // ── Tab: Agent 设置 ────────────────────────────

  function renderAgentTab() {
    return (
      <>
        <section>
          <h3 className="text-[13px] font-semibold text-foreground mb-3">Agent 身份</h3>
          <div className="space-y-3">
            <div>
              <Label>名称</Label>
              <Input value={identityName} onChange={(e) => setIdentityName(e.target.value)} placeholder="如 Samantha" className="text-[13px] h-9" />
            </div>
            <div>
              <Label>主题 / 风格</Label>
              <Input value={identityTheme} onChange={(e) => setIdentityTheme(e.target.value)} placeholder="如 helpful sloth" className="text-[13px] h-9" />
            </div>
            <div>
              <Label>Emoji 标识</Label>
              <Input value={identityEmoji} onChange={(e) => setIdentityEmoji(e.target.value)} placeholder="如 🦥" className="text-[13px] h-9 w-24" />
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-[13px] font-semibold text-foreground mb-3">消息设置</h3>
          <div className="space-y-3">
            <div>
              <Label>回复前缀</Label>
              <Input value={responsePrefix} onChange={(e) => setResponsePrefix(e.target.value)} placeholder="默认 🦞" className="text-[13px] h-9 w-32" />
            </div>
            <div>
              <Label>确认反应</Label>
              <Input value={ackReaction} onChange={(e) => setAckReaction(e.target.value)} placeholder="默认 👀" className="text-[13px] h-9 w-32" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">回复前缀默认 🦞，确认反应默认 👀（来自 Emoji 标识）</p>
        </section>
      </>
    );
  }

  // ── Tab: 会话配置 ──────────────────────────────

  function renderSessionTab() {
    return (
      <>
        <section>
          <Label>会话隔离模式</Label>
          <Select value={dmScope} onChange={(e) => setDmScope(e.target.value)}>
            <option value="main">main（所有 DM 共享主会话）</option>
            <option value="per-peer">per-peer（按发送者跨通道隔离）</option>
            <option value="per-channel-peer">per-channel-peer（按通道+发送者隔离）</option>
            <option value="per-account-channel-peer">per-account-channel-peer（按账号+通道+发送者隔离）</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 main</p>
        </section>

        <section>
          <Label>重置模式</Label>
          <Select value={resetMode} onChange={(e) => setResetMode(e.target.value)}>
            <option value="">未配置</option>
            <option value="daily">daily（每日定时重置）</option>
            <option value="idle">idle（空闲超时重置）</option>
          </Select>
          {resetMode === "daily" && (
            <div className="mt-3">
              <Label>每日重置时间（0-23 时）</Label>
              <Input value={resetAtHour} onChange={(e) => setResetAtHour(e.target.value)} type="number" min={0} max={23} placeholder="4" className="text-[13px] h-9 w-24" />
              <p className="text-[11px] text-muted-foreground mt-1">默认凌晨 4 点</p>
            </div>
          )}
          {resetMode === "idle" && (
            <div className="mt-3">
              <Label>空闲重置时间（分钟）</Label>
              <Input value={resetIdleMinutes} onChange={(e) => setResetIdleMinutes(e.target.value)} type="number" placeholder="60" className="text-[13px] h-9 w-24" />
              <p className="text-[11px] text-muted-foreground mt-1">默认 60 分钟</p>
            </div>
          )}
        </section>

        <section>
          <Label>重置指令</Label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {resetTriggers.map((t) => (
              <TagChip key={t} label={t} onRemove={() => setResetTriggers((prev) => prev.filter((x) => x !== t))} />
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newResetTrigger}
              onChange={(e) => setNewResetTrigger(e.target.value)}
              placeholder="如 /clear"
              className="text-[13px] h-9 flex-1"
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
            }} disabled={!newResetTrigger.trim()} className="h-9 px-3">
              <Plus className="w-3.5 h-3.5 mr-1" /> 添加
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 /new 和 /reset</p>
        </section>
      </>
    );
  }

  // ── Tab: 日志配置 ──────────────────────────────

  function renderLoggingTab() {
    return (
      <>
        <section>
          <Label>日志级别</Label>
          <Select value={logLevel} onChange={(e) => setLogLevel(e.target.value)}>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 info</p>
        </section>

        <section>
          <Label>日志文件路径</Label>
          <Input value={logFile} onChange={(e) => setLogFile(e.target.value)} placeholder="留空使用默认路径 /tmp/openclaw/openclaw-YYYY-MM-DD.log" className="text-[13px] h-9" />
        </section>

        <section>
          <Label>控制台日志级别</Label>
          <Select value={consoleLevel} onChange={(e) => setConsoleLevel(e.target.value)}>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 info，使用 --verbose 时自动升级为 debug</p>
        </section>

        <section>
          <Label>敏感信息脱敏</Label>
          <Select value={redactSensitive} onChange={(e) => setRedactSensitive(e.target.value)}>
            <option value="off">off（不脱敏）</option>
            <option value="tools">tools（工具输出脱敏）</option>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1.5">默认 tools</p>
        </section>
      </>
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

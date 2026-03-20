import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ResourceWithId } from "@/lib/db";
import { resourceArgs } from "@/lib/tauri";
import {
  Play,
  Square,
  RotateCcw,
  Loader2,
  ScrollText,
  StopCircle,
} from "lucide-react";

// ── Types ────────────────────────────────────────

interface ControlPanelProps {
  resource: ResourceWithId | null;
  running: "running" | "stopped" | "unknown";
  onRefresh: () => Promise<void>;
}

type LogEntry =
  | { type: "stream"; text: string }
  | { type: "action"; text: string; kind: "info" | "success" | "error" | "warn" };

// ── Component ────────────────────────────────────

export default function ControlPanel({ resource, running, onRefresh }: ControlPanelProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // 日志相关
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logStreaming, setLogStreaming] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const MAX_LOG_LINES = 500;

  // ── 监听日志事件 ─────────────────────────────

  useEffect(() => {
    const unlisten = listen<{ line: string }>("gateway:log", (event) => {
      setLogs((prev) => {
        const entry: LogEntry = { type: "stream", text: event.payload.line };
        const next = [...prev, entry];
        return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── 辅助函数 ──────────────────────────────────

  function appendActionLog(text: string, kind: "info" | "success" | "error" | "warn" = "info") {
    setLogs((prev) => {
      const entry: LogEntry = { type: "action", text, kind };
      const next = [...prev, entry];
      return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
    });
  }

  async function pollUntilStatus(expectRunning: boolean, maxRetries = 8, interval = 1500): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, interval));
      try {
        const raw = await invoke<string>("get_daemon_info", resourceArgs(resource));
        const info = JSON.parse(raw);
        const isRunning = info.runtime === "running";
        if (isRunning === expectRunning) return true;
      } catch { /* continue polling */ }
    }
    return false;
  }

  async function restartLogStream() {
    if (!resource) return;
    try { await invoke("stop_log_stream"); } catch { /* ignore */ }
    try {
      await invoke("start_log_stream", resourceArgs(resource));
      setLogStreaming(true);
    } catch { /* ignore */ }
  }

  // ── 网关操作 ──────────────────────────────────

  // 检测输出是否表示服务未安装/已禁用
  function isServiceDisabled(output: string): boolean {
    const lower = output.toLowerCase();
    return lower.includes("disabled") || lower.includes("not installed") || lower.includes("not found") || lower.includes("not loaded");
  }

  // 智能启动：先 start，若服务未安装则 daemon install + start
  async function handleStart() {
    if (!resource) return;
    setActionLoading("start");
    appendActionLog("▶ 正在启动小龙虾...", "info");
    try {
      let output = await invoke<string>("gateway_control", { action: "start", ...resourceArgs(resource) });
      if (output?.trim()) {
        // "Config invalid" with "unknown channel id" is a runtime validation warning
        // (plugins register channels after config validation); gateway still starts
        if (output.includes("Config invalid") && output.includes("unknown channel id")) {
          appendActionLog("⚠ 配置校验警告（插件注册的通道类型，不影响运行）", "warn");
        } else {
          appendActionLog(output.trim(), "info");
        }
      }

      // 检查输出是否表示服务未安装/已禁用 → 需要先安装
      if (output && isServiceDisabled(output)) {
        appendActionLog("检测到服务未安装，正在执行 daemon install...", "warn");
        try {
          const installOutput = await invoke<string>("gateway_control", { action: "install", ...resourceArgs(resource) });
          if (installOutput?.trim()) appendActionLog(installOutput.trim(), "info");
          appendActionLog("服务安装完成，正在启动...", "info");
        } catch (installErr) {
          appendActionLog(`安装服务失败: ${String(installErr)}`, "error");
          throw installErr;
        }
        output = await invoke<string>("gateway_control", { action: "start", ...resourceArgs(resource) });
        if (output?.trim()) appendActionLog(output.trim(), "info");
      }

      appendActionLog("等待服务就绪...", "info");
      const ready = await pollUntilStatus(true);
      if (ready) {
        appendActionLog("✓ 小龙虾启动成功", "success");
        await restartLogStream();
      } else {
        appendActionLog("⚠ 服务启动超时，请查看日志排查问题", "warn");
      }
      await onRefresh();
    } catch (err) {
      appendActionLog(`✗ 启动失败: ${String(err)}`, "error");
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  }

  // 停止：gateway stop（无论什么方式启动都停止）
  async function handleStop() {
    if (!resource) return;
    setActionLoading("stop");
    appendActionLog("■ 正在停止小龙虾...", "info");
    try {
      const output = await invoke<string>("gateway_control", { action: "stop", ...resourceArgs(resource) });
      if (output?.trim()) appendActionLog(output.trim(), "info");
      appendActionLog("等待服务停止...", "info");
      const stopped = await pollUntilStatus(false);
      if (stopped) {
        appendActionLog("✓ 小龙虾已停止", "success");
      } else {
        appendActionLog("⚠ 服务可能仍在运行", "warn");
      }
      await onRefresh();
    } catch (err) {
      appendActionLog(`✗ 停止失败: ${String(err)}`, "error");
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  }

  // 重启：gateway restart
  async function handleRestart() {
    if (!resource) return;
    setActionLoading("restart");
    appendActionLog("↻ 正在重启小龙虾...", "info");
    try {
      const output = await invoke<string>("gateway_control", { action: "restart", ...resourceArgs(resource) });
      if (output?.trim()) appendActionLog(output.trim(), "info");
      appendActionLog("等待服务就绪...", "info");
      const ready = await pollUntilStatus(true);
      if (ready) {
        appendActionLog("✓ 小龙虾重启成功", "success");
        await restartLogStream();
      } else {
        appendActionLog("⚠ 重启超时，请查看日志排查问题", "warn");
      }
      await onRefresh();
    } catch (err) {
      appendActionLog(`✗ 重启失败: ${String(err)}`, "error");
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  }

  // ── 日志流 ────────────────────────────────────

  async function startLogStream() {
    if (!resource) return;
    setLogs([]);
    try {
      await invoke("start_log_stream", resourceArgs(resource));
      setLogStreaming(true);
    } catch (err) {
      console.error("启动日志流失败:", err);
    }
  }

  async function stopLogStream() {
    try { await invoke("stop_log_stream"); } catch { /* ignore */ }
    setLogStreaming(false);
  }

  // 自动启动日志流
  useEffect(() => {
    if (!resource || logStreaming) return;
    (async () => {
      try {
        await invoke("start_log_stream", resourceArgs(resource));
        setLogStreaming(true);
      } catch (err) {
        console.error("自动启动日志流失败:", err);
      }
    })();
  }, [resource]);

  // 组件卸载时停止流
  useEffect(() => {
    return () => {
      invoke("stop_log_stream").catch(() => {});
    };
  }, []);

  // ── 渲染 ─────────────────────────────────────

  const isStopped = running === "stopped" || running === "unknown";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── 实时日志（全区域） ─────────────────── */}
      <section className="flex-1 rounded-2xl border border-border/60 bg-card shadow-lg flex flex-col overflow-hidden min-h-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-2">
            <ScrollText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[13px] font-semibold text-foreground">实时日志</span>
            <div className={`w-2 h-2 rounded-full ${
              running === "running" ? "status-running" :
              running === "stopped" ? "status-stopped" : "bg-zinc-600"
            }`} />
          </div>
          <div className="flex items-center gap-1">
            {/* 启动 / 停止 */}
            {isStopped ? (
              <Tooltip content="启动小龙虾">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={handleStart}
                  disabled={!!actionLoading}
                >
                  {actionLoading === "start"
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Play className="w-3 h-3" />}
                </Button>
              </Tooltip>
            ) : (
              <Tooltip content="停止小龙虾">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={handleStop}
                  disabled={!!actionLoading}
                >
                  {actionLoading === "stop"
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Square className="w-3 h-3" />}
                </Button>
              </Tooltip>
            )}
            {/* 重启 */}
            <Tooltip content="重启小龙虾">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={handleRestart}
                disabled={!!actionLoading || isStopped}
              >
                {actionLoading === "restart"
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <RotateCcw className="w-3 h-3" />}
              </Button>
            </Tooltip>
            {/* 分隔线 + 日志控制 */}
            <div className="w-px h-4 bg-border/60 mx-1" />
            {logStreaming ? (
              <Tooltip content="停止日志">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-red-400 hover:text-red-300"
                  onClick={stopLogStream}
                >
                  <StopCircle className="w-3 h-3" />
                </Button>
              </Tooltip>
            ) : (
              <Tooltip content="开始日志">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={startLogStream}
                >
                  <ScrollText className="w-3 h-3" />
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed text-zinc-300 bg-[#0c0c0c]">
          {logs.length === 0 && logStreaming && (
            <div className="flex items-center gap-2 text-muted-foreground py-4 justify-center">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>等待日志输出...</span>
            </div>
          )}
          {logs.length === 0 && !logStreaming && (
            <p className="text-muted-foreground text-center py-8">
              日志流未启动
            </p>
          )}
          {logs.map((entry, i) => {
            if (entry.type === "action") {
              const colorClass =
                entry.kind === "success" ? "text-green-400" :
                entry.kind === "error" ? "text-red-400" :
                entry.kind === "warn" ? "text-amber-400" :
                "text-blue-400";
              return (
                <div key={i} className={`whitespace-pre-wrap break-all font-semibold ${colorClass}`}>
                  {entry.text}
                </div>
              );
            }
            return (
              <div key={i} className="whitespace-pre-wrap break-all">
                {entry.text}
              </div>
            );
          })}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { ResourceWithId } from "@/lib/db";
import {
  Play,
  Square,
  RotateCcw,
  Loader2,
  Circle,
  ScrollText,
  StopCircle,
} from "lucide-react";

// ── Types ────────────────────────────────────────

interface ControlPanelProps {
  resource: ResourceWithId | null;
  running: "running" | "stopped" | "unknown";
  onRefresh: () => Promise<void>;
}

// ── Helpers ──────────────────────────────────────

function resourceArgs(r: ResourceWithId | null) {
  return {
    target: r?.type ?? "local",
    host: r?.host ?? null,
    port: r?.port ?? null,
    username: r?.username ?? null,
    password: r?.password ?? null,
  };
}

// ── Component ────────────────────────────────────

export default function ControlPanel({ resource, running, onRefresh }: ControlPanelProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // 日志相关
  const [logs, setLogs] = useState<string[]>([]);
  const [logStreaming, setLogStreaming] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const MAX_LOG_LINES = 500;

  // ── 监听日志事件 ─────────────────────────────

  useEffect(() => {
    const unlisten = listen<{ line: string }>("gateway:log", (event) => {
      setLogs((prev) => {
        const next = [...prev, event.payload.line];
        return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
      });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── 网关操作 ──────────────────────────────────

  // 智能启动：先 start，失败则 install + start
  async function handleStart() {
    if (!resource) return;
    setActionLoading("start");
    try {
      try {
        await invoke<string>("gateway_control", { action: "start", ...resourceArgs(resource) });
      } catch {
        // start 失败 → 尝试先安装再启动
        await invoke<string>("gateway_control", { action: "install", ...resourceArgs(resource) });
        await invoke<string>("gateway_control", { action: "start", ...resourceArgs(resource) });
      }
      await new Promise((r) => setTimeout(r, 1500));
      await onRefresh();
    } catch (err) {
      console.error("启动网关失败:", err);
    } finally {
      setActionLoading(null);
    }
  }

  // 停止：gateway stop（无论什么方式启动都停止）
  async function handleStop() {
    if (!resource) return;
    setActionLoading("stop");
    try {
      await invoke<string>("gateway_control", { action: "stop", ...resourceArgs(resource) });
      await new Promise((r) => setTimeout(r, 1500));
      await onRefresh();
    } catch (err) {
      console.error("停止网关失败:", err);
    } finally {
      setActionLoading(null);
    }
  }

  // 重启：gateway restart
  async function handleRestart() {
    if (!resource) return;
    setActionLoading("restart");
    try {
      await invoke<string>("gateway_control", { action: "restart", ...resourceArgs(resource) });
      await new Promise((r) => setTimeout(r, 2000));
      await onRefresh();
    } catch (err) {
      console.error("重启网关失败:", err);
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
      <section className="flex-1 rounded-xl border border-border/60 bg-white shadow-sm flex flex-col overflow-hidden min-h-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-2">
            <ScrollText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[13px] font-semibold text-foreground">实时日志</span>
            <Circle className={`w-2 h-2 ${
              running === "running" ? "fill-green-500 text-green-500" :
              running === "stopped" ? "fill-red-400 text-red-400" :
              "fill-gray-300 text-gray-300"
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
                  className="h-7 px-2 text-red-500 hover:text-red-600"
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
        <div className="flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed text-[#5a5a5a] bg-[#fbfbfb]">
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
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  );
}

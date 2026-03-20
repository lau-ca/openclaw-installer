import { invoke } from "@tauri-apps/api/core";

/**
 * 确保当前运行在 Tauri 环境中，否则抛出错误。
 * 替代散落在各页面中的 `(window as any).__TAURI_INTERNALS__` 检查。
 */
export function ensureTauriRuntime(): void {
  if (!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
    throw new Error(
      "未检测到 Tauri 运行时，请确保在 Tauri 窗口中运行应用（使用 npm run tauri dev），而非浏览器中直接访问"
    );
  }
}

/**
 * 安全调用 Tauri invoke，自动检查运行时环境。
 */
export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  ensureTauriRuntime();
  return invoke<T>(cmd, args);
}

/**
 * 从 ResourceWithId 或类似对象构建统一的 Tauri 命令资源参数。
 * 消除各页面中重复的参数展开模式。
 */
export function resourceArgs(r: {
  type?: string;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
} | null): {
  target: string;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
} {
  return {
    target: r?.type ?? "local",
    host: r?.host ?? null,
    port: r?.port ?? null,
    username: r?.username ?? null,
    password: r?.password ?? null,
  };
}

/**
 * 判断 openclaw 输出是否表示命令未安装。
 * 兼容 Linux / macOS / Windows 的错误输出。
 */
export function isOpenclawNotInstalled(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("command not found") ||
    lower.includes("not found") ||
    lower.includes("not recognized") ||
    lower.includes("无法执行 openclaw") ||
    lower.includes("is not recognized") ||
    lower.includes("不是内部或外部命令") ||
    lower.includes("找不到命令")
  );
}

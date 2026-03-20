import { useState, useCallback, useRef, useEffect } from "react";
import type { SSHConfig } from "@/types/app";
import { safeInvoke } from "@/lib/tauri";

// ── Toast Hook ──────────────────────────────────────

type ToastKind = "success" | "error";

interface ToastState {
  open: boolean;
  message: string;
  title: string;
  kind: ToastKind;
}

export function useToast() {
  const [state, setState] = useState<ToastState>({
    open: false,
    message: "",
    title: "",
    kind: "error",
  });

  const show = useCallback((kind: ToastKind, message: string, title?: string) => {
    setState({ open: true, message, title: title ?? (kind === "success" ? "成功" : "错误"), kind });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  return { toast: state, showToast: show, closeToast: close };
}

// ── SSH Test Hook ───────────────────────────────────

type SSHTestStatus = "idle" | "testing" | "success" | "error";

export function useSSHTest(
  sshConfig: SSHConfig,
  setSSHTested: (v: boolean) => void,
) {
  const [testStatus, setTestStatus] = useState<SSHTestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");

  const canTest =
    sshConfig.host.trim() !== "" &&
    sshConfig.username.trim() !== "" &&
    sshConfig.password.trim() !== "";

  const runTest = useCallback(async () => {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const result = await safeInvoke<string>("test_ssh_connection", {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        password: sshConfig.password,
      });
      setTestStatus("success");
      setTestMessage(result);
      setSSHTested(true);
      return { success: true, message: result };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setTestStatus("error");
      setTestMessage(errMsg);
      setSSHTested(false);
      return { success: false, message: errMsg };
    }
  }, [sshConfig.host, sshConfig.port, sshConfig.username, sshConfig.password, setSSHTested]);

  return { testStatus, testMessage, canTest, runTest, setTestStatus, setTestMessage };
}

// ── Save Resource & Navigate Hook ───────────────────

import { addResource } from "@/lib/db";
import { WizardStep } from "@/types/app";
import { useWizardStore } from "@/stores/wizard-store";

/**
 * 共享的「保存资源并跳转到 START」逻辑。
 * 消除 SystemCheckPage 和 InstallPage 中重复的 handleStartUse。
 */
export function useSaveAndStart() {
  const { installTarget, sshConfig, goToStep } = useWizardStore();
  const [saving, setSaving] = useState(false);

  const saveAndStart = useCallback(async () => {
    setSaving(true);
    try {
      await addResource({
        name: "默认资源",
        type: installTarget === "remote" ? "remote" : "local",
        ...(installTarget === "remote"
          ? {
              host: sshConfig.host,
              port: sshConfig.port,
              username: sshConfig.username,
              password: sshConfig.password,
            }
          : {}),
      });
    } catch (err) {
      console.error("保存设置失败:", err);
    } finally {
      setSaving(false);
      goToStep(WizardStep.START);
    }
  }, [installTarget, sshConfig, goToStep]);

  return { saving, saveAndStart };
}

// ── Safe Async Effect (prevents state update on unmounted component) ──

export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

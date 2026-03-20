import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWizardStore } from "@/stores/wizard-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { fadeIn, staggerChild } from "@/lib/animations";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Server,
  Eye,
  EyeOff,
} from "lucide-react";

type TestStatus = "idle" | "testing" | "success" | "error";

export default function SSHConfigPage() {
  const { sshConfig, setSSHConfig, setSSHTested, nextStep, prevStep } =
    useWizardStore();
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isNextLoading, setIsNextLoading] = useState(false);

  const canTest =
    sshConfig.host.trim() !== "" &&
    sshConfig.username.trim() !== "" &&
    sshConfig.password.trim() !== "";

  async function handleTest() {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const result = await invoke<string>("test_ssh_connection", {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        password: sshConfig.password,
      });
      setTestStatus("success");
      setTestMessage(result);
      setSSHTested(true);
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : String(err));
      setSSHTested(false);
    }
  }

  async function handleNext() {
    setIsNextLoading(true);
    setTestStatus("idle");
    setTestMessage("");
    try {
      await invoke<string>("test_ssh_connection", {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        password: sshConfig.password,
      });
      setSSHTested(true);
      nextStep();
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : String(err));
      setSSHTested(false);
    } finally {
      setIsNextLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
      {/* Form */}
      <div className="flex-1 overflow-auto space-y-5 p-3 -m-3 scroll-mask-y">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" strokeWidth={1.5} />
            <h3 className="text-[14px] font-semibold text-foreground">
              SSH 连接配置
            </h3>
          </div>
          <Button
            onClick={handleTest}
            disabled={!canTest || testStatus === "testing"}
            variant="secondary"
            size="sm"
            className="h-8 text-[13px] px-4 bg-white border shadow-sm hover:bg-slate-50 transition-colors"
          >
            {testStatus === "testing" ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Server className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
            )}
            {testStatus === "testing" ? "测试中..." : "测试连接"}
          </Button>
        </div>

        {/* Host + Port */}
        <motion.div {...staggerChild(0)} className="grid grid-cols-[1fr_100px] gap-3">
          <div>
            <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
              主机地址
            </label>
            <Input
              placeholder="192.168.1.100 或 example.com"
              value={sshConfig.host}
              onChange={(e) => setSSHConfig({ host: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
              端口
            </label>
            <Input
              type="number"
              value={sshConfig.port}
              onChange={(e) => setSSHConfig({ port: Number(e.target.value) || 22 })}
            />
          </div>
        </motion.div>

        {/* Username */}
        <motion.div {...staggerChild(1)}>
          <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
            用户名
          </label>
          <Input
            placeholder="root"
            value={sshConfig.username}
            onChange={(e) => setSSHConfig({ username: e.target.value })}
          />
        </motion.div>

        {/* Password */}
        <motion.div {...staggerChild(2)}>
          <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
            密码
          </label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="输入 SSH 密码"
              value={sshConfig.password}
              onChange={(e) => setSSHConfig({ password: e.target.value })}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-0 h-full px-3 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </motion.div>

        {/* Result message */}
        <motion.div {...staggerChild(3)} className="pt-2">
          {testStatus !== "idle" && testStatus !== "testing" && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "mt-3 px-4 py-3 rounded-lg text-[13px] flex items-start gap-2",
                testStatus === "success"
                  ? "bg-green-500/10 border border-green-500/20 text-green-400"
                  : "bg-red-500/10 border border-red-500/20 text-red-400"
              )}
            >
              {testStatus === "success" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span className="break-all">{testMessage}</span>
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* Footer */}
      <motion.div
        {...fadeIn(0.3)}
        className="flex justify-between mt-4 shrink-0"
      >
        <Button variant="ghost" onClick={prevStep} disabled={isNextLoading}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          上一步
        </Button>
        <Button onClick={handleNext} disabled={!canTest || isNextLoading || testStatus === "testing"}>
          {isNextLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : null}
          {isNextLoading ? "连接中..." : "下一步"}
          {!isNextLoading && <ArrowRight className="w-4 h-4 ml-2" />}
        </Button>
      </motion.div>
    </div>
  );
}

/**
 * 应用全局类型定义
 * OpenClaw Installer - 向导流程与安装目标
 */

export type InstallTarget = "local" | "remote";

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export type CheckStatus = "pending" | "running" | "pass" | "fail" | "warn";

export interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export enum WizardStep {
  TARGET_SELECT = "target-select",
  SYSTEM_CHECK = "system-check",
  INSTALL = "install",
  START = "start",
}

export interface WizardStepMeta {
  step: WizardStep;
  title: string;
  description: string;
  index: number;
}

export function getLocalSteps(): WizardStepMeta[] {
  return [
    { step: WizardStep.TARGET_SELECT, title: "选择安装目标", description: "选择在本机或远程 Linux 上安装", index: 1 },
    { step: WizardStep.SYSTEM_CHECK, title: "环境检测", description: "检查系统环境是否满足要求", index: 2 },
    { step: WizardStep.INSTALL, title: "安装", description: "下载并安装 OpenClaw", index: 3 },
  ];
}

export function getRemoteSteps(): WizardStepMeta[] {
  return [
    { step: WizardStep.TARGET_SELECT, title: "选择安装目标", description: "选择在本机或远程 Linux 上安装", index: 1 },
    { step: WizardStep.SYSTEM_CHECK, title: "环境检测", description: "检查远程服务器环境", index: 2 },
    { step: WizardStep.INSTALL, title: "安装", description: "下载并安装 OpenClaw", index: 3 },
  ];
}

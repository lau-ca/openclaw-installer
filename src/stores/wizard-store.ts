import { create } from "zustand";
import {
  type InstallTarget,
  type SSHConfig,
  type WizardStepMeta,
  WizardStep,
  getLocalSteps,
  getRemoteSteps,
} from "@/types/app";

const defaultSSHConfig: SSHConfig = {
  host: "",
  port: 22,
  username: "root",
  password: "",
};

interface WizardState {
  installTarget: InstallTarget | null;
  currentStep: WizardStep;
  steps: WizardStepMeta[];
  sshConfig: SSHConfig;
  sshTested: boolean;

  setInstallTarget: (target: InstallTarget) => void;
  setSSHConfig: (config: Partial<SSHConfig>) => void;
  setSSHTested: (tested: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: WizardStep) => void;
  reset: () => void;
}

function getStepIndex(steps: WizardStepMeta[], step: WizardStep): number {
  return steps.findIndex((s) => s.step === step);
}

export const useWizardStore = create<WizardState>((set, get) => ({
  installTarget: null,
  currentStep: WizardStep.TARGET_SELECT,
  steps: getLocalSteps(),
  sshConfig: { ...defaultSSHConfig },
  sshTested: false,

  setInstallTarget: (target: InstallTarget) => {
    const steps = target === "local" ? getLocalSteps() : getRemoteSteps();
    set({ installTarget: target, steps });
  },

  nextStep: () => {
    const { steps, currentStep } = get();
    const idx = getStepIndex(steps, currentStep);
    if (idx < steps.length - 1) set({ currentStep: steps[idx + 1].step });
  },

  prevStep: () => {
    const { steps, currentStep } = get();
    const idx = getStepIndex(steps, currentStep);
    if (idx > 0) set({ currentStep: steps[idx - 1].step });
  },

  setSSHConfig: (config: Partial<SSHConfig>) =>
    set((state) => ({
      sshConfig: { ...state.sshConfig, ...config },
      sshTested: false,
    })),

  setSSHTested: (tested: boolean) => set({ sshTested: tested }),

  goToStep: (step: WizardStep) => set({ currentStep: step }),

  reset: () =>
    set({
      installTarget: null,
      currentStep: WizardStep.TARGET_SELECT,
      steps: getLocalSteps(),
      sshConfig: { ...defaultSSHConfig },
      sshTested: false,
    }),
}));

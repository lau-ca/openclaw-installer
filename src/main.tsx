import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import StepIndicator from "@/components/StepIndicator";
import WizardShell from "@/components/WizardShell";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useWizardStore } from "@/stores/wizard-store";
import { WizardStep } from "@/types/app";
import { hasResources } from "@/lib/db";

function App() {
  const { currentStep, goToStep } = useWizardStore();
  const isStartPage = currentStep === WizardStep.START;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hasResources()
      .then((exists) => {
        if (exists) {
          goToStep(WizardStep.START);
        }
      })
      .catch((err) => {
        console.error("检查资源状态失败:", err);
      })
      .finally(() => {
        setReady(true);
      });
  }, []);

  if (!ready) {
    return (
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        <div className="h-8 shrink-0" data-tauri-drag-region />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div className="h-8 shrink-0" data-tauri-drag-region />
      {!isStartPage && <StepIndicator />}
      <main className="flex-1 px-8 pb-6 pt-4 overflow-auto">
        <ErrorBoundary>
          <WizardShell />
        </ErrorBoundary>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

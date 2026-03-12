import { useWizardStore } from "@/stores/wizard-store";
import { WizardStep } from "@/types/app";
import { motion, AnimatePresence } from "framer-motion";
import { pageTransition } from "@/lib/animations";
import TargetSelectPage from "@/pages/TargetSelectPage";
import SystemCheckPage from "@/pages/SystemCheckPage";
import InstallPage from "@/pages/InstallPage";
import StartPage from "@/pages/StartPage";

function renderStep(step: WizardStep) {
  switch (step) {
    case WizardStep.TARGET_SELECT:
      return <TargetSelectPage />;
    case WizardStep.SYSTEM_CHECK:
      return <SystemCheckPage />;
    case WizardStep.INSTALL:
      return <InstallPage />;
    case WizardStep.START:
      return <StartPage />;
    default:
      return <TargetSelectPage />;
  }
}

export default function WizardShell() {
  const { currentStep } = useWizardStore();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentStep}
        initial={pageTransition.initial}
        animate={pageTransition.animate}
        exit={pageTransition.exit}
        transition={pageTransition.transition}
        className="h-full"
      >
        {renderStep(currentStep)}
      </motion.div>
    </AnimatePresence>
  );
}

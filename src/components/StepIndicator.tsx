import React from "react";
import { useWizardStore } from "@/stores/wizard-store";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export default function StepIndicator() {
  const { steps, currentStep } = useWizardStore();
  const currentIndex = steps.findIndex((s) => s.step === currentStep);

  return (
    <div className="flex items-center gap-2 px-8 py-3">
      {steps.map((stepMeta, index) => {
        const isActive = index === currentIndex;
        const isCompleted = index < currentIndex;

        return (
          <React.Fragment key={stepMeta.step}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-semibold transition-all duration-300 shadow-sm",
                  isActive && "bg-primary text-primary-foreground",
                  isCompleted && "bg-primary/20 text-primary",
                  !isActive && !isCompleted && "bg-secondary text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="w-3 h-3" strokeWidth={3} />
                ) : (
                  stepMeta.index
                )}
              </div>
              <span
                className={cn(
                  "text-[14px] font-semibold hidden sm:inline transition-colors duration-300 tracking-wide",
                  isActive && "text-foreground",
                  isCompleted && "text-primary",
                  !isActive && !isCompleted && "text-muted-foreground"
                )}
              >
                {stepMeta.title}
              </span>
            </div>

            {index < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-px transition-colors duration-300",
                  index < currentIndex ? "bg-primary/30" : "bg-border"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

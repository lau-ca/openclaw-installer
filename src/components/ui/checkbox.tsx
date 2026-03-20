import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const innerId = id || React.useId();
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={innerId}
          className={cn(
            "h-4 w-4 shrink-0 rounded border border-input accent-primary cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          ref={ref}
          {...props}
        />
        {label && (
          <label
            htmlFor={innerId}
            className="text-[13px] text-foreground cursor-pointer select-none"
          >
            {label}
          </label>
        )}
      </div>
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };

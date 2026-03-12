import * as React from "react";
import { cn } from "@/lib/utils";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => {
    return (
      <label
        className={cn(
          "text-[12px] text-muted-foreground mb-1 block select-none",
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
        {required && (
          <span className="ml-0.5 text-red-500">*</span>
        )}
      </label>
    );
  },
);
Label.displayName = "Label";

export { Label };

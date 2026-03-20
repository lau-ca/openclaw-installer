import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50 select-none btn-press",
  {
    variants: {
      variant: {
        default: "gradient-primary text-white shadow-lg hover:shadow-xl glow-primary-hover transition-smooth",
        destructive: "bg-destructive text-destructive-foreground shadow-lg hover:bg-destructive/90",
        outline: "border border-border bg-transparent shadow-sm hover:bg-primary/10 hover:border-primary/50 hover:text-primary",
        secondary: "bg-secondary text-secondary-foreground shadow-lg hover:bg-secondary/80 border border-border",
        ghost: "hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> { }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

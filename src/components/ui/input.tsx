import * as React from "react";

import { cn } from "@/lib/utils";

const fieldClass =
  "border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-9 w-full min-w-0 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(fieldClass, className)} {...props} />;
}

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="native-select" className={cn(fieldClass, "pr-8", className)} {...props} />;
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("text-sm font-medium", className)} {...props} />;
}

export { Input, Label, NativeSelect };

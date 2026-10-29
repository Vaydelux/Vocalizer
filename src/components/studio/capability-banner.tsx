"use client";

import type { ReactNode } from "react";
import { Info, ShieldAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "warning" | "unavailable";

const TONE_STYLES: Record<Tone, { wrap: string; icon: string; Icon: typeof Info }> = {
  info: { wrap: "border-border bg-muted/40 text-muted-foreground", icon: "", Icon: Info },
  warning: {
    wrap: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    icon: "",
    Icon: TriangleAlert,
  },
  unavailable: {
    wrap: "border-border bg-muted/40 text-muted-foreground",
    icon: "",
    Icon: ShieldAlert,
  },
};

/**
 * Honest capability banner. Used for genuinely unimplemented capabilities —
 * the message is the source of truth, never a disabled button pretending.
 */
export function CapabilityBanner({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
}) {
  const { wrap, Icon } = TONE_STYLES[tone];
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-lg border p-4", wrap)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-1 leading-relaxed opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}

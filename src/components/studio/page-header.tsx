"use client";

import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUi } from "@/lib/studio/store-ui";
import { HELP_BY_ID } from "@/lib/studio/help-content";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  const view = useUi((s) => s.activeView);
  const openHelp = useUi((s) => s.openHelp);
  const topic = HELP_BY_ID[view];
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions}
        {view !== "help" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="outline" size="sm"
                aria-label={`Quick Help for ${topic.title}`}
                onClick={() => openHelp(view)} className="gap-1.5">
                <CircleHelp className="h-4 w-4" aria-hidden /> Help
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs space-y-1">
              <p className="font-semibold">{topic.title}</p>
              <p>{topic.summary}</p>
              <p className="opacity-80">Click for every button explained, steps, and limitations.</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

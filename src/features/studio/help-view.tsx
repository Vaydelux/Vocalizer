"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Search, Info, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/studio/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { HELP_ENTRIES, HELP_BY_ID } from "@/lib/studio/help-content";
import { useUi, type ViewId } from "@/lib/studio/store-ui";

export function HelpView() {
  const [search, setSearch] = useState("");
  const selected = useUi((s) => s.helpTopicId);
  const setView = useUi((s) => s.setView);
  const [expanded, setExpanded] = useState<string[]>(selected ? [selected] : ["home"]);
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    if (!q) return HELP_ENTRIES;
    return HELP_ENTRIES.filter((item) => [
      item.title, item.summary, item.availability, item.caution ?? "",
      ...item.steps,
      ...item.controls.flatMap((c) => [c.label,c.description]),
    ].some((value) => value.toLocaleLowerCase().includes(q)));
  }, [search]);

  const openWorkspace = (view: ViewId) => setView(view);
  const returnTo = selected && selected !== "help" ? selected : "home";

  return (
    <div className="space-y-5">
      <PageHeader title="Quick Help"
        description="Step-by-step instructions and an explanation for each major button, control, and workspace. Tooltips use the same information as this guide."
        actions={<Button variant="outline" size="sm" onClick={() => openWorkspace(returnTo)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back to workspace
        </Button>} />
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="h-4 w-4 text-primary" aria-hidden /> Start here
        </div>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Download the complete Windows x64 portable app and extract the whole folder.</li>
          <li>Run Vocalizer.exe, then import a short WAV/MP3 file from Home.</li>
          <li>Select an editing workspace, preview the result and save the output.</li>
          <li>Use Processing Queue to inspect jobs. Save work before closing the app.</li>
          <li>For AI Remover only, choose the exact separately acquired, checksum-approved ONNX model. No model weights are bundled.</li>
        </ol>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Debug preview: multi-stem Splitter and arbitrary Model Manager registrations are not executable. Imported library items are not saved projects. No feature is guaranteed bug-free until real Windows testing.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="help-search" className="text-sm font-medium">Search features and controls</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input id="help-search" className="pl-9" placeholder="Examples: crossfade, microphone, model, export, cancellation"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <p role="status" className="text-xs text-muted-foreground">{filtered.length} guide sections</p>
      </div>
      <Accordion type="multiple" value={search.trim() ? filtered.map((x) => x.id) : expanded}
        onValueChange={setExpanded} className="space-y-2">
        {filtered.map((entry) => (
          <AccordionItem key={entry.id} value={entry.id} className="rounded-lg border border-border bg-card px-4">
            <AccordionTrigger className="hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left">
                <span>{entry.title}</span>
                <span className="text-xs font-normal text-muted-foreground">{entry.availability}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{entry.summary}</p>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">How to use</h3>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                  {entry.steps.map((step, index) => <li key={index}>{step}</li>)}
                </ol>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Controls and tooltips</h3>
                <dl className="divide-y divide-border rounded-lg border border-border">
                  {entry.controls.map((control) => (
                    <div key={control.label} className="space-y-1 px-3 py-2.5">
                      <dt className="font-medium text-sm">{control.label}</dt>
                      <dd className="text-xs leading-relaxed text-muted-foreground">{control.description}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              {entry.caution && (
                <p className="rounded-lg border border-amber-500/30 p-3 text-xs leading-relaxed text-muted-foreground">
                  <strong>Important:</strong> {entry.caution}
                </p>
              )}
              {entry.id !== "help" && (
                <Button variant="outline" size="sm" onClick={() => openWorkspace(entry.id)}>
                  Open {HELP_BY_ID[entry.id].title} <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      {filtered.length === 0 && <p role="status" className="text-sm text-muted-foreground">No matching controls. Try a shorter term such as “export” or “model”.</p>}
      <p className="pb-4 text-xs leading-relaxed text-muted-foreground">
        Keyboard: Alt+1 Home, Alt+2 Cutter, Alt+3 Joiner, Alt+4 Pitcher,
        Alt+5 Remover, Alt+6 Queue. Screen-reader users can use page-heading help
        buttons and this searchable guide; hover is never required.
      </p>
    </div>
  );
}

"use client";

/**
 * Enterprise Broadcast Compliance & Cryptographic Audit Modal
 *
 * Provides studio engineers with a comprehensive overview of cryptographic SHA-256
 * file integrity hashes, EBU R128 / ITU-R BS.1770 broadcast delivery certifications,
 * and 1-click JSON/CSV compliance report generation.
 */

import { useState } from "react";
import {
  ShieldCheck,
  FileCheck,
  FileSpreadsheet,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  Award,
  Layers,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCompliance } from "@/lib/studio/compliance";
import { toast } from "sonner";

interface ComplianceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ComplianceModal({ open, onOpenChange }: ComplianceModalProps) {
  const entries = useCompliance((s) => s.entries);
  const clearAll = useCompliance((s) => s.clearAll);
  const exportReport = useCompliance((s) => s.exportReport);

  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const totalOps = entries.length;
  const compliantCount = entries.filter((e) => e.loudnessMetrics?.ebuR128Compliant).length;
  const measuredCount = entries.filter((e) => e.loudnessMetrics).length;
  const passRate = measuredCount > 0 ? Math.round((compliantCount / measuredCount) * 100) : null;

  const copyToClipboard = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedHash(text);
    toast.success(`Copied ${label} SHA-256 to clipboard`);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold flex items-center gap-2">
                  Enterprise Broadcast & Cryptographic Compliance
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">
                    Measurement status only
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Recorded audit metadata and measured loudness results. An entry is not an independent certification.
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3 my-3">
          <Card className="bg-card/40 border-border">
            <CardContent className="p-3">
              <div className="text-[11px] font-medium text-muted-foreground">Total Logged Operations</div>
              <div className="text-xl font-bold mt-0.5">{totalOps}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/40 border-border">
            <CardContent className="p-3">
              <div className="text-[11px] font-medium text-muted-foreground">Measured EBU R128 Pass Rate</div>
              <div className="text-xl font-bold mt-0.5 flex items-center gap-1.5">
                <span className={passRate !== null && passRate >= 90 ? "text-emerald-400" : "text-amber-400"}>{passRate === null ? "N/A" : `${passRate}%`}</span>
                <span className="text-[11px] font-normal text-muted-foreground">({compliantCount}/{measuredCount} measured)</span>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/40 border-border">
            <CardContent className="p-3">
              <div className="text-[11px] font-medium text-muted-foreground">Target Broadcast Standard</div>
              <div className="text-xs font-semibold mt-1 text-foreground flex items-center gap-1">
                <Award className="h-3.5 w-3.5 text-primary" />
                -23 LUFS ±0.5 LU · TP ≤ -1 dBTP
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Audit Log Table */}
        <div className="flex-1 min-h-0 flex flex-col border rounded-lg border-border bg-card/20 overflow-hidden">
          <div className="bg-muted/40 px-3 py-2 border-b border-border text-[11px] font-medium grid grid-cols-12 gap-2 text-muted-foreground">
            <span className="col-span-2">Timestamp</span>
            <span className="col-span-2">Operation</span>
            <span className="col-span-3">Target Audio / Hash</span>
            <span className="col-span-3">Loudness (LUFS / TP)</span>
            <span className="col-span-2 text-right">Status</span>
          </div>

          <ScrollArea className="flex-1 p-2">
            {entries.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
                No audit entries recorded yet.
                <p className="text-[11px] mt-1 opacity-70">
                  Only operations that successfully record actual file hashes or audio measurements appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {entries.map((entry) => {
                  const isCompliant = entry.loudnessMetrics?.ebuR128Compliant ?? false;
                  return (
                    <div
                      key={entry.id}
                      className="p-2.5 rounded-md border border-border/60 bg-card/40 hover:bg-card/80 transition-colors grid grid-cols-12 gap-2 items-center text-xs"
                    >
                      {/* Timestamp */}
                      <span className="col-span-2 font-mono text-[10px] text-muted-foreground truncate">
                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>

                      {/* Operation */}
                      <div className="col-span-2 flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px] uppercase font-mono px-1.5 py-0">
                          {entry.operation}
                        </Badge>
                      </div>

                      {/* File Name & SHA-256 */}
                      <div className="col-span-3 min-w-0">
                        <div className="font-medium truncate text-[11px]" title={entry.output.name}>
                          {entry.output.name}
                        </div>
                        {entry.output.sha256 && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(entry.output.sha256!, "Output")}
                            className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground hover:text-foreground mt-0.5 truncate"
                            title={`SHA-256: ${entry.output.sha256}`}
                          >
                            {copiedHash === entry.output.sha256 ? (
                              <Check className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                            ) : (
                              <Copy className="h-2.5 w-2.5 opacity-60 shrink-0" />
                            )}
                            <span className="truncate">{entry.output.sha256.slice(0, 16)}…</span>
                          </button>
                        )}
                      </div>

                      {/* Loudness metrics */}
                      <div className="col-span-3 text-[11px] text-muted-foreground">
                        {entry.loudnessMetrics ? (
                          <div>
                            <span className="font-mono text-foreground font-medium">
                              {entry.loudnessMetrics.integratedLufs.toFixed(1)} LUFS
                            </span>
                            <span className="text-[10px] opacity-70 ml-1.5 font-mono">
                              TP: {entry.loudnessMetrics.truePeakDb.toFixed(1)} dBTP
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50 italic text-[10px]">Unmeasured</span>
                        )}
                      </div>

                      {/* Status */}
                      <div className="col-span-2 text-right">
                        {entry.loudnessMetrics ? (
                          isCompliant ? (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] px-2">
                              PASS
                            </Badge>
                          ) : (
                            <Badge className="bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] px-2 flex items-center gap-1 ml-auto">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              FAIL
                            </Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            NOT MEASURED
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Footer actions */}
        <div className="pt-3 border-t border-border flex items-center justify-between">
          <Button
            size="sm"
            variant="ghost"
            onClick={clearAll}
            disabled={entries.length === 0}
            className="text-xs h-8 text-muted-foreground hover:text-destructive gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear Audit Ledger
          </Button>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportReport("csv")}
              disabled={entries.length === 0}
              className="text-xs h-8 gap-1.5"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
              Export CSV Ledger
            </Button>

            <Button
              size="sm"
              variant="default"
              onClick={() => exportReport("json")}
              disabled={entries.length === 0}
              className="text-xs h-8 gap-1.5"
            >
              <FileCheck className="h-3.5 w-3.5" />
              Export JSON Audit Report
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

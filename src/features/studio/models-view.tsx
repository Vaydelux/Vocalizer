"use client";

/**
 * Model Manager — registry and management interface.
 * True installation status, adapter compatibility with reasons, manifest
 * validation, and the protected built-in fallback slot. Import validation
 * registers metadata only; inference stays unavailable in this build.
 */

import { useState } from "react";
import { Boxes, HardDrive, ShieldCheck, FileJson, Trash2, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { CapabilityBanner } from "@/components/studio/capability-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModels } from "@/lib/studio/store-models";
import { useSettings } from "@/lib/studio/store-settings";
import { formatBytes, formatTime } from "@/lib/studio/format";

export function ModelsView() {
  const adapters = useModels((s) => s.adapters);
  const builtin = useModels((s) => s.builtin);
  const userModels = useModels((s) => s.userModels);
  const validations = useModels((s) => s.validations);
  const validateAndRegister = useModels((s) => s.validateAndRegister);
  const removeUserModel = useModels((s) => s.removeUserModel);
  const preferredModelId = useSettings((s) => s.preferredModelId);
  const updateSettings = useSettings((s) => s.update);

  const [raw, setRaw] = useState("");
  const last = validations[0];

  const doValidate = () => {
    if (raw.trim().length === 0) {
      toast.error("Paste a model manifest (JSON) first");
      return;
    }
    const result = validateAndRegister(raw);
    if (result.ok) {
      toast.success("Manifest valid — registered as metadata", {
        description: "Inference remains unavailable: no compatible runtime in this build.",
      });
    } else {
      toast.error(`Manifest rejected — ${result.issues.length} issue(s)`);
    }
  };

  const modelOptions = [
    { id: builtin.id, name: builtin.name },
    ...userModels.map((m) => ({ id: m.manifest.modelId, name: m.manifest.displayName })),
  ];

  return (
    <div>
      <PageHeader
        title="Model Manager"
        description="Local model registry: true installation status, adapter compatibility with explicit reasons, and the protected built-in slot. No model downloads occur in this phase."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Built-in slot */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Built-in model (reserved)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{builtin.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {builtin.architecture} · {builtin.format} · adapter {builtin.adapterId}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400">
                  Not installed
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{builtin.note}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {builtin.supportedStems.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2.5 text-xs">
              <span className="text-muted-foreground">Fallback readiness</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">Not ready — no installed model</span>
            </div>
          </CardContent>
        </Card>

        {/* Preferred + storage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HardDrive className="h-4 w-4 text-primary" aria-hidden /> Preferences &amp; storage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Preferred model</p>
              <Select
                value={preferredModelId ?? ""}
                onValueChange={(v) => updateSettings({ preferredModelId: v })}
              >
                <SelectTrigger className="w-full" aria-label="Preferred model">
                  <SelectValue placeholder="None selected" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Preference is persisted; usability is validated at processing time, not assumed here.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2.5 text-xs">
              <span className="text-muted-foreground">User-installed models</span>
              <span className="font-mono tabular-nums">{userModels.length} · {formatBytes(0)} on disk</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Model files are not downloaded or imported in this phase. Registered manifests occupy no
              disk space; real model storage accounting arrives with the download/install feature.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* User models */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">User-registered models ({userModels.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {userModels.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No user models registered. Validate a manifest below to register one as metadata — it will
              still be unavailable for inference until a compatible runtime exists.
            </p>
          ) : (
            <div className="studio-scroll max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Architecture</TableHead>
                    <TableHead>Runtime</TableHead>
                    <TableHead>Stems</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userModels.map((m) => (
                    <TableRow key={m.manifest.modelId}>
                      <TableCell className="max-w-[220px] truncate font-medium">{m.manifest.displayName}</TableCell>
                      <TableCell>{m.manifest.format}</TableCell>
                      <TableCell>{m.manifest.architecture}</TableCell>
                      <TableCell className="text-xs">{m.manifest.requiredRuntime}</TableCell>
                      <TableCell className="text-xs">{m.manifest.supportedStems.join(", ")}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                          Registered · inference unavailable
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Remove ${m.manifest.displayName}`}
                          onClick={() => {
                            const r = removeUserModel(m.manifest.modelId);
                            if (r.ok) toast.success("Model registration removed");
                            else toast.error(r.reason ?? "Removal failed");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manifest validator */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileJson className="h-4 w-4 text-primary" aria-hidden /> Model manifest validator (schema v1)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='{"schemaVersion":1,"modelId":"example.mdx-vocals","displayName":"…","format":".onnx","adapterId":"onnxruntime.mdxnet",…}'
            className="studio-scroll h-32 font-mono text-xs"
            aria-label="Model manifest JSON"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={doValidate}>Validate manifest</Button>
            <p className="text-[11px] text-muted-foreground">
              Validation is strict: schema, adapter registry, runtime names, and file-hash coverage.
            </p>
          </div>
          {last && (
            <div
              className={
                last.ok
                  ? "rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400"
                  : "rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
              }
            >
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                {last.ok ? <CircleCheck className="h-3.5 w-3.5" aria-hidden /> : <CircleX className="h-3.5 w-3.5" aria-hidden />}
                {last.ok
                  ? `Valid — registered “${last.manifest.displayName}” as metadata (inference unavailable in this build).`
                  : `Invalid manifest — ${last.issues.length} issue(s):`}
              </p>
              {!last.ok && (
                <ul className="studio-scroll max-h-24 list-disc overflow-y-auto pl-4">
                  {last.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Adapters */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Registered adapters ({adapters.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="studio-scroll max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Adapter</TableHead>
                  <TableHead>Formats</TableHead>
                  <TableHead>Architectures</TableHead>
                  <TableHead>Runtime</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adapters.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.label}</TableCell>
                    <TableCell className="text-xs">{a.formats.join(", ")}</TableCell>
                    <TableCell className="text-xs">{a.architectures.join(", ")}</TableCell>
                    <TableCell className="text-xs">{a.runtime}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
                        <TriangleAlert className="h-3 w-3" aria-hidden /> Unavailable
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <CapabilityBanner tone="unavailable" title="Why every adapter reports unavailable">
            No inference runtime (ONNX Runtime, PyTorch) is bundled in this build. Adapters are typed
            registrations that declare formats, architectures, runtimes, and validation contracts — they
            do not pretend to execute models. All stubs are marked not-implemented by design.
          </CapabilityBanner>
        </CardContent>
      </Card>

      {/* Validation history */}
      {validations.length > 1 && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Validation history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {validations.slice(0, 8).map((v, i) => (
                <li key={i} className="flex items-center gap-2">
                  {v.ok ? (
                    <CircleCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                  ) : (
                    <CircleX className="h-3.5 w-3.5 text-destructive" aria-hidden />
                  )}
                  <span className="font-mono">{formatTime((v.validatedAt % 86400000) / 1000)}</span>
                  <span>{v.ok ? "valid manifest registered" : `rejected (${v.issues.length} issues)`}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Boxes className="h-4 w-4" aria-hidden />
        Future capabilities (downloads, checksum verification, import of weights, dependency install,
        benchmarking) are specified in the architecture contract and intentionally not simulated here.
      </div>
    </div>
  );
}

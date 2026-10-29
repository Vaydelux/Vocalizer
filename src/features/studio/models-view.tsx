"use client";

/**
 * Model Manager — registry and management interface.
 *
 * Sections: A. Built-in · B. Installed models · C. Model details ·
 * D. Local import (real SHA-256 + format/architecture detection) ·
 * E. Model storage (real disk usage from manifest file sizes) ·
 * F. Future catalog (honestly disabled — no fabricated downloads).
 *
 * No inference is ever enabled in this build. A "recognized" model file is
 * registered as metadata only; the resolver always reports runtime-unavailable.
 */

import { useRef, useState } from "react";
import {
  Boxes,
  HardDrive,
  ShieldCheck,
  FileJson,
  Trash2,
  CircleCheck,
  CircleX,
  TriangleAlert,
  FileSearch,
  ChevronRight,
  ChevronDown,
  CloudDownload,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { CapabilityBanner } from "@/components/studio/capability-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModels } from "@/lib/studio/store-models";
import { useSettings } from "@/lib/studio/store-settings";
import { formatBytes } from "@/lib/studio/format";
import type { ModelInspectionResult } from "@/lib/studio/types";

export function ModelsView() {
  const adapters = useModels((s) => s.adapters);
  const builtin = useModels((s) => s.builtin);
  const userModels = useModels((s) => s.userModels);
  const validations = useModels((s) => s.validations);
  const validateAndRegister = useModels((s) => s.validateAndRegister);
  const removeUserModel = useModels((s) => s.removeUserModel);
  const inspectFiles = useModels((s) => s.inspectFiles);
  const storageUsage = useModels((s) => s.storageUsage);
  const preferredModelId = useSettings((s) => s.preferredModelId);
  const updateSettings = useSettings((s) => s.update);

  const [raw, setRaw] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<ModelInspectionResult | null>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const configFileRef = useRef<HTMLInputElement>(null);
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [configFiles, setConfigFiles] = useState<File[]>([]);

  const last = validations[0];
  const storage = storageUsage();

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

  const runInspection = async () => {
    if (!primaryFile) {
      toast.error("Choose a model file first");
      return;
    }
    setInspecting(true);
    try {
      const result = await inspectFiles(primaryFile, configFiles);
      setInspection(result);
      if (result.ok) {
        toast.success("Inspection complete", { description: result.verdict });
      } else {
        toast.error("Inspection failed", { description: result.verdict });
      }
    } finally {
      setInspecting(false);
    }
  };

  // Register an inspected file as metadata: synthesize a manifest from the
  // inspection result + a generated id, then run it through the strict validator.
  const registerInspected = () => {
    if (!inspection?.ok) return;
    const id = inspection.fileName
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/g, ".")
      .slice(0, 60);
    const manifest = {
      schemaVersion: 1,
      modelId: `user.${id}`,
      displayName: inspection.fileName,
      modelVersion: "inspected",
      architecture: inspection.detectedArchitecture ?? "custom-pytorch",
      format: inspection.format,
      adapterId: inspection.compatibleAdapterIds[0] ?? "custom.pytorch",
      requiredRuntime:
        inspection.compatibleAdapterIds[0]?.startsWith("onnxruntime")
          ? "onnxruntime-cpu"
          : "pytorch-cpu",
      origin: "user-imported",
      supportedStems: ["Vocals", "Instrumental"],
      supportedDevices: ["cpu"],
      files: [
        {
          path: inspection.fileName,
          sha256: inspection.sha256 ?? undefined,
          sizeBytes: inspection.sizeBytes,
        },
      ],
      provenance: `Imported ${new Date().toISOString()} via local inspection.`,
      license: "Unverified — user must confirm before any future use.",
    };
    const json = JSON.stringify(manifest, null, 2);
    const result = validateAndRegister(json);
    if (result.ok) {
      toast.success("Registered as metadata", {
        description: "Inference stays unavailable — no runtime is bundled.",
      });
    } else {
      toast.error(`Registration rejected — ${result.issues.length} issue(s)`);
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
        description="Universal registry: typed adapter contracts, strict manifest validation, real local-file inspection, and the protected built-in fallback. No model downloads or inference in this phase."
      />

      {/* A. Built-in model */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> A · Built-in model (reserved)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{builtin.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {builtin.architecture} · {builtin.format} · adapter {builtin.adapterId}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400">
                Not included yet
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{builtin.note}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {builtin.supportedStems.map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/40 p-2.5 text-xs">
            <span className="text-muted-foreground">Fallback readiness</span>
            <span className="font-medium text-amber-600 dark:text-amber-400">Not ready — no installed model</span>
          </div>
        </CardContent>
      </Card>

      {/* B. Installed models + C. details */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">B · Installed models ({userModels.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {userModels.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No user models registered. Inspect a local file below or validate a manifest to register one as
              metadata — inference stays unavailable until a compatible runtime ships.
            </p>
          ) : (
            <div className="studio-scroll max-h-80 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Architecture</TableHead>
                    <TableHead>Runtime</TableHead>
                    <TableHead>Stems</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userModels.map((m) => {
                    const isOpen = expanded === m.manifest.modelId;
                    return (
                      <>
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
                            <div className="flex items-center">
                              <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : m.manifest.modelId)}
                                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                                aria-label={isOpen ? "Collapse details" : "Show details"}
                              >
                                {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                              </button>
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
                            </div>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={m.manifest.modelId + "-detail"}>
                            <TableCell colSpan={7} className="bg-muted/30 p-3">
                              <div className="grid gap-2 text-xs sm:grid-cols-2">
                                <div><span className="text-muted-foreground">Model ID:</span> <span className="font-mono">{m.manifest.modelId}</span></div>
                                <div><span className="text-muted-foreground">Version:</span> {m.manifest.modelVersion}</div>
                                <div><span className="text-muted-foreground">Adapter:</span> {m.manifest.adapterId}</div>
                                <div><span className="text-muted-foreground">Origin:</span> {m.manifest.origin}</div>
                                <div><span className="text-muted-foreground">Devices:</span> {m.manifest.supportedDevices.join(", ")}</div>
                                <div><span className="text-muted-foreground">License:</span> {m.manifest.license}</div>
                                <div className="sm:col-span-2">
                                  <span className="text-muted-foreground">Files:</span>
                                  <ul className="ml-4 mt-1 list-disc">
                                    {m.manifest.files.map((f) => (
                                      <li key={f.path} className="font-mono">
                                        {f.path}
                                        {f.sizeBytes ? ` · ${formatBytes(f.sizeBytes)}` : ""}
                                        {f.sha256 ? ` · sha256:${f.sha256.slice(0, 12)}…` : " · no hash"}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                {m.manifest.provenance && (
                                  <div className="sm:col-span-2"><span className="text-muted-foreground">Provenance:</span> {m.manifest.provenance}</div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* D. Local import (real inspection) */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileSearch className="h-4 w-4 text-primary" aria-hidden /> D · Local model import (inspection)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium">Model file (.onnx/.pth/.pt/.ckpt/.safetensors)</p>
              <input
                ref={modelFileRef}
                type="file"
                accept=".onnx,.pth,.pt,.ckpt,.safetensors"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setPrimaryFile(f);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" className="w-full justify-start truncate" onClick={() => modelFileRef.current?.click()}>
                {primaryFile ? primaryFile.name : "Choose model file…"}
              </Button>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium">Associated configs (.yaml/.yml/.json) — optional</p>
              <input
                ref={configFileRef}
                type="file"
                accept=".yaml,.yml,.json"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) setConfigFiles(files);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" className="w-full justify-start truncate" onClick={() => configFileRef.current?.click()}>
                {configFiles.length > 0 ? `${configFiles.length} config file(s)` : "Choose config files…"}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void runInspection()} disabled={!primaryFile || inspecting} className="gap-1.5">
              {inspecting ? <CircleCheck className="h-3.5 w-3.5 animate-pulse" aria-hidden /> : <FileSearch className="h-3.5 w-3.5" aria-hidden />}
              {inspecting ? "Inspecting…" : "Inspect file"}
            </Button>
            {primaryFile && (
              <span className="text-xs text-muted-foreground">{formatBytes(primaryFile.size)}</span>
            )}
          </div>

          {inspection && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-medium">{inspection.verdict}</p>
              <div className="grid gap-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-2">
                <span>File: {inspection.fileName}</span>
                <span>Format: {inspection.format ?? "unrecognized"}</span>
                <span>Architecture: {inspection.detectedArchitecture ?? "unknown"}</span>
                <span>Size: {formatBytes(inspection.sizeBytes)}</span>
                <span className="break-all">SHA-256: {inspection.sha256 ?? "unavailable"}</span>
                <span>Compatible adapters: {inspection.compatibleAdapterIds.length > 0 ? inspection.compatibleAdapterIds.join(", ") : "none"}</span>
              </div>
              {inspection.associatedConfigs.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Associated configs: {inspection.associatedConfigs.join(", ")}
                </p>
              )}
              {inspection.issues.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-600 dark:text-amber-400">
                  {inspection.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={registerInspected}
                  disabled={!inspection.ok}
                  className="gap-1.5"
                >
                  <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Register as metadata
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Metadata only — inference is never enabled from an import.
                </span>
              </div>
            </div>
          )}
          <CapabilityBanner tone="unavailable" title="Imports never execute">
            Inspected files are hashed and recognized, never deserialized or run. Untrusted PyTorch
            checkpoints are not pickle-loaded; unknown safetensors files are not loaded as runnable models;
            no Python scripts are accepted as adapters.
          </CapabilityBanner>
        </CardContent>
      </Card>

      {/* E. Model storage + preferences */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HardDrive className="h-4 w-4 text-primary" aria-hidden /> E · Model storage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <Row label="Storage directory" value={storage.directory} />
            <Row label="Installed model size" value={formatBytes(storage.installedBytes)} />
            <Row label="Cache size" value={formatBytes(storage.cacheBytes)} />
            <Row label="Registered models" value={String(storage.registeredCount)} />
            <Row label="Available adapters" value={String(storage.adapterCount)} />
            {storage.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5 rounded bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {w}
              </p>
            ))}
            <div className="space-y-1.5 pt-1">
              <p className="font-medium">Preferred model</p>
              <Select value={preferredModelId ?? ""} onValueChange={(v) => updateSettings({ preferredModelId: v })}>
                <SelectTrigger className="w-full" aria-label="Preferred model">
                  <SelectValue placeholder="None selected" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* F. Future catalog */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CloudDownload className="h-4 w-4 text-primary" aria-hidden /> F · Future model catalog
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Downloadable model packages are reserved for when a verified download + checksum-verification
              implementation ships. No catalogs, sizes, or progress are fabricated.
            </p>
            <div className="space-y-1.5">
              {["MDX-Net vocals (default candidate)", "Demucs v4 (htdemucs)", "BS-RoFormer (vocals/bass/drums)"].map((label) => (
                <div key={label} className="flex items-center justify-between rounded-lg border border-dashed border-border p-2.5 text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <Button size="sm" variant="ghost" disabled className="h-7 gap-1.5 text-xs text-muted-foreground">
                    <CloudDownload className="h-3.5 w-3.5" aria-hidden /> Download
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Buttons stay disabled until a real, verified download implementation exists.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Manifest validator */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileJson className="h-4 w-4 text-primary" aria-hidden /> Manifest validator (strict schema v1)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='{"schemaVersion":1,"modelId":"example.mdx","displayName":"…","architecture":"mdx-net","format":".onnx","adapterId":"onnxruntime.mdxnet","requiredRuntime":"onnxruntime-cpu","origin":"user-imported","supportedStems":["Vocals","Instrumental"],"supportedDevices":["cpu"],"files":[{"path":"model.onnx","sha256":"…","sizeBytes":0}],"license":"…"}'
            className="studio-scroll h-32 font-mono text-xs"
            aria-label="Model manifest JSON"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={doValidate}>Validate manifest</Button>
            <p className="text-[11px] text-muted-foreground">
              Strict: unknown keys (incl. <code>command</code>/<code>script</code>/<code>exec</code>) and
              traversal/absolute file paths are rejected.
            </p>
          </div>
          {last && (
            <div className={
              last.ok
                ? "rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400"
                : "rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            }>
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                {last.ok ? <CircleCheck className="h-3.5 w-3.5" aria-hidden /> : <CircleX className="h-3.5 w-3.5" aria-hidden />}
                {last.ok
                  ? `Valid — registered “${last.manifest.displayName}” as metadata (inference unavailable in this build).`
                  : `Invalid manifest — ${last.issues.length} issue(s):`}
              </p>
              {!last.ok && (
                <ul className="studio-scroll max-h-24 list-disc overflow-y-auto pl-4">
                  {last.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Adapters */}
      <Card className="mb-4">
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
                  <TableHead>Runtimes</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adapters.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.label}</TableCell>
                    <TableCell className="text-xs">{a.formats.join(", ")}</TableCell>
                    <TableCell className="text-xs">{a.architectures.join(", ")}</TableCell>
                    <TableCell className="text-xs">{a.runtime.join(", ")}</TableCell>
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
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Boxes className="h-4 w-4" aria-hidden />
        Future capabilities (downloads, checksum verification, dependency install, benchmarking, real
        inference) are specified in the adapter contracts and intentionally not simulated here.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-mono tabular-nums" title={value}>{value}</span>
    </div>
  );
}

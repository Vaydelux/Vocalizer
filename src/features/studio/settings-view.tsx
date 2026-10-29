"use client";

/**
 * Settings — validated, persisted local preferences. Desktop-only settings are
 * shown as honest N/A rows rather than fake controls.
 */

import { Moon, Sun, RotateCcw, MonitorCog } from "lucide-react";
import { PageHeader } from "@/components/studio/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSettings } from "@/lib/studio/store-settings";
import { useModels } from "@/lib/studio/store-models";
import { RUNTIME_INFO } from "@/lib/studio/app-info";

export function SettingsView() {
  const s = useSettings();
  const userModels = useModels((st) => st.userModels);
  const builtin = useModels((st) => st.builtin);
  const update = useSettings((st) => st.update);
  const reset = useSettings((st) => st.reset);

  const modelOptions = [
    { id: builtin.id, name: builtin.name },
    ...userModels.map((m) => ({ id: m.manifest.modelId, name: m.manifest.displayName })),
  ];

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Local preferences persisted with schema validation and corruption recovery. Nothing sensitive is stored."
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset to defaults
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Appearance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Theme</Label>
              <RadioGroup
                value={s.theme}
                onValueChange={(v) => update({ theme: v as "dark" | "light" })}
                className="flex gap-2"
              >
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="dark" id="theme-dark" />
                  <Moon className="h-4 w-4" aria-hidden /> Dark
                </label>
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="light" id="theme-light" />
                  <Sun className="h-4 w-4" aria-hidden /> Light
                </label>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Accent color</Label>
              <RadioGroup
                value={s.accent}
                onValueChange={(v) => update({ accent: v as "violet" | "indigo" })}
                className="flex gap-2"
              >
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="violet" id="accent-violet" />
                  <span className="h-3 w-3 rounded-full bg-violet-500" aria-hidden /> Violet
                </label>
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="indigo" id="accent-indigo" />
                  <span className="h-3 w-3 rounded-full bg-indigo-500" aria-hidden /> Indigo
                </label>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Default playback volume</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{Math.round(s.volume * 100)}%</span>
              </div>
              <Slider
                aria-label="Default playback volume"
                value={[s.volume]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(v) => update({ volume: v[0] ?? 0.8 })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Export &amp; processing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Export format</Label>
                <Select value={s.exportFormat} onValueChange={(v) => update({ exportFormat: v as "wav16" | "wav24" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wav16">WAV · 16-bit PCM</SelectItem>
                    <SelectItem value="wav24">WAV · 24-bit PCM</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Compressed encoders arrive with the desktop FFmpeg pipeline.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sample rate</Label>
                <Select
                  value={String(s.sampleRate)}
                  onValueChange={(v) => update({ sampleRate: v === "auto" ? "auto" : v === "44100" ? 44100 : 48000 })}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Keep source rate</SelectItem>
                    <SelectItem value="44100">44100 Hz</SelectItem>
                    <SelectItem value="48000">48000 Hz</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Concurrent processing jobs</Label>
              <RadioGroup
                value={String(s.concurrency)}
                onValueChange={(v) => update({ concurrency: v === "2" ? 2 : 1 })}
                className="flex gap-2"
              >
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="1" id="conc-1" /> 1 (safest)
                </label>
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-sm has-[[data-state=checked]]:border-primary">
                  <RadioGroupItem value="2" id="conc-2" /> 2
                </label>
              </RadioGroup>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-xs font-medium">Show detailed job logs</p>
                <p className="text-[11px] text-muted-foreground">Keep per-job diagnostics in the queue view.</p>
              </div>
              <Switch defaultChecked aria-label="Show detailed job logs" disabled />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Models &amp; fallback policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Preferred model</Label>
              <Select
                value={s.preferredModelId ?? undefined}
                onValueChange={(v) => update({ preferredModelId: v })}
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
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fallback policy (applies when AI processing ships)</Label>
              <Select
                value={s.fallbackPolicy}
                onValueChange={(v) => update({ fallbackPolicy: v as "cpu-then-embedded" | "embedded-only" | "error" })}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpu-then-embedded">Retry CPU, then embedded default, then error</SelectItem>
                  <SelectItem value="embedded-only">Embedded default only</SelectItem>
                  <SelectItem value="error">Never fall back — report errors directly</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Stored now so the policy is stable when inference lands. Fallback is currently “not
                ready — no installed model”, and the queue reports a real error instead of guessing.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MonitorCog className="h-4 w-4 text-primary" aria-hidden /> Desktop-build settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Setting</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs">FFmpeg / FFprobe paths</TableCell>
                  <TableCell className="text-xs text-muted-foreground">N/A — bundled binaries in the desktop build</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs">Rubber Band engine</TableCell>
                  <TableCell className="text-xs text-muted-foreground">Probed at runtime by the desktop build; web preview uses its own DSP</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs">Default export directory</TableCell>
                  <TableCell className="text-xs text-muted-foreground">N/A — web preview delivers downloads via the browser</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs">Processing engine</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{RUNTIME_INFO.engine}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

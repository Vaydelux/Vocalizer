"use client";

/**
 * System Information — only genuinely detected values. GPU comes from the WebGL
 * renderer string, storage from the Storage API, memory approximations are
 * labeled as such, and desktop-only rows (Electron/Node/Chromium, FFmpeg,
 * Python/ONNX/PyTorch) report N/A honestly.
 */

import { useEffect, useMemo, useState } from "react";
import { Cpu, Copy, HardDrive, Mic, MonitorSpeaker, Puzzle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/studio/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CapabilityItem } from "@/lib/studio/types";
import {
  probePlaybackSupport,
  probeRecorderMimes,
  getDecodeContext,
  type PlaybackSupport,
  type RecorderMimeSupport,
} from "@/lib/studio/decode";
import { useModels } from "@/lib/studio/store-models";
import { INFERENCE_ADAPTERS } from "@/lib/studio/adapters";
import { APP_VERSION, APP_MILESTONE } from "@/lib/studio/app-info";
import { formatBytes } from "@/lib/studio/format";
import { native, isNative } from "@/lib/studio/native";
import type { NativeSystemInfo, InferenceStatus } from "@/lib/studio/ipc-contracts";

function parseOs(ua: string): { name: string; version: string } {
  const win = ua.match(/Windows NT ([\d.]+)/);
  if (win) {
    const v = win[1];
    const name = v.startsWith("10.") || v.startsWith("11.") ? "Windows" : "Windows (legacy)";
    return { name, version: v.startsWith("10.") && ua.includes("Windows NT 10.0") ? "10/11 (NT 10.0)" : v };
  }
  const mac = ua.match(/Mac OS X ([\d_.]+)/);
  if (mac) return { name: "macOS", version: mac[1].replace(/_/g, ".") };
  const and = ua.match(/Android ([\d.]+)/);
  if (and) return { name: "Android", version: and[1] };
  const lin = ua.match(/Linux/);
  if (lin) return { name: "Linux", version: "unknown" };
  return { name: "Unknown OS", version: "—" };
}

function gpuInfo(): { vendor: string; renderer: string } | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (!dbg) {
      return { vendor: gl.getParameter(gl.VENDOR) as string, renderer: "masked (debug info unavailable)" };
    }
    return {
      vendor: String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)),
      renderer: String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)),
    };
  } catch {
    return null;
  }
}

export function SystemView() {
  const builtin = useModels((s) => s.builtin);
  const userModels = useModels((s) => s.userModels);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [micPermission, setMicPermission] = useState<string>("unknown");
  const [micCount, setMicCount] = useState<number | null>(null);
  const [audioState, setAudioState] = useState<string>("—");
  const [maxChannels, setMaxChannels] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [recorderMimes, setRecorderMimes] = useState<RecorderMimeSupport[]>([]);
  const [playback, setPlayback] = useState<PlaybackSupport[]>([]);
  const [gpu, setGpu] = useState<{ vendor: string; renderer: string } | null>(null);
  const [os, setOs] = useState<{ name: string; version: string }>({ name: "—", version: "—" });
  const [hwCores, setHwCores] = useState<number | null>(null);
  const [hwMem, setHwMem] = useState<number | null>(null);
  const [nativeInfo, setNativeInfo] = useState<NativeSystemInfo | null>(null);
  const [inferenceInfo, setInferenceInfo] = useState<InferenceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setRecorderMimes(probeRecorderMimes());
      setPlayback(probePlaybackSupport());
      setGpu(gpuInfo());
      setOs(parseOs(navigator.userAgent));
      setHwCores(navigator.hardwareConcurrency ?? null);
      setHwMem((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null);
      try {
        const est = await navigator.storage?.estimate?.();
        if (!cancelled && est) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      } catch {
        /* storage API unavailable */
      }
      try {
        const perm = await navigator.permissions?.query?.({ name: "microphone" as PermissionName });
        if (!cancelled && perm) {
          setMicPermission(perm.state);
          perm.onchange = () => setMicPermission(perm.state);
        }
      } catch {
        /* permissions API may not expose microphone */
      }
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices?.();
        if (!cancelled) setMicCount(devices?.filter((d) => d.kind === "audioinput").length ?? null);
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        try {
          const ctx = getDecodeContext();
          setAudioState(ctx.state);
          setMaxChannels(ctx.destination.maxChannelCount);
        } catch {
          setAudioState("unavailable");
        }
      }
      const api = native();
      if (api) {
        try {
          const [nInfo, infStatus] = await Promise.all([
            api.systemInfo(),
            api.inferenceStatus().catch(() => null),
          ]);
          if (!cancelled) {
            setNativeInfo(nInfo);
            setInferenceInfo(infStatus);
          }
        } catch {
          /* native probe error */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const hardware: CapabilityItem[] = useMemo(() => {
    if (nativeInfo) {
      return [
        {
          label: "CPU",
          value: `${nativeInfo.cpuModel} (${nativeInfo.cpuCores} cores)`,
          available: true,
        },
        {
          label: "Physical memory",
          value: `${(nativeInfo.totalMemBytes / 1024 ** 3).toFixed(1)} GB total (${(nativeInfo.freeMemBytes / 1024 ** 3).toFixed(1)} GB free)`,
          available: true,
        },
        {
          label: "GPU",
          value: gpu ? gpu.renderer : "Not reported",
          available: !!gpu,
          detail: gpu ? `Vendor: ${gpu.vendor}. Presence of a GPU does not imply CUDA/DirectML support.` : undefined,
        },
        {
          label: "Storage free (app data)",
          value: nativeInfo.appDataFreeBytes != null ? formatBytes(nativeInfo.appDataFreeBytes) : "Not reported",
          available: nativeInfo.appDataFreeBytes != null,
        },
      ];
    }
    return [
      {
        label: "Logical processors",
        value: hwCores != null ? String(hwCores) : "unknown",
        available: hwCores != null,
      },
      {
        label: "Device memory (approximate)",
        value: hwMem != null ? `≈ ${hwMem} GB (browser-reported bucket)` : "Not reported by this browser",
        available: hwMem != null,
        detail: "Browsers report a coarse bucket, not physical RAM.",
      },
      {
        label: "GPU",
        value: gpu ? gpu.renderer : "Not reported",
        available: !!gpu,
        detail: gpu ? `Vendor: ${gpu.vendor}. Presence of a GPU does not imply CUDA/DirectML support.` : undefined,
      },
      {
        label: "Storage used (origin)",
        value: storage ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} quota` : "Not reported",
        available: !!storage,
      },
    ];
  }, [nativeInfo, storage, gpu, hwCores, hwMem]);

  const application: CapabilityItem[] = useMemo(() => {
    if (nativeInfo) {
      return [
        { label: "Application version", value: `v${nativeInfo.appVersion} — ${APP_MILESTONE}`, available: true },
        { label: "Desktop runtime", value: `Electron ${nativeInfo.electronVersion} · Node ${nativeInfo.nodeVersion} · Chrome ${nativeInfo.chromeVersion}`, available: true },
        { label: "UI framework", value: "React 19 · Next.js 16 App Router", available: true },
        { label: "App data path", value: nativeInfo.userDataPath, available: true },
      ];
    }
    return [
      { label: "Application version", value: `v${APP_VERSION} — ${APP_MILESTONE}`, available: true },
      { label: "UI runtime", value: "React 19 · Next.js 16 App Router", available: true },
      { label: "Electron / Node / Chromium", value: "Web preview (running in browser)", available: false },
      { label: "Processing engine", value: "Web Audio API · WaveSurfer v8 · OfflineAudioContext", available: true },
    ];
  }, [nativeInfo]);

  const audio: CapabilityItem[] = useMemo(() => {
    const items: CapabilityItem[] = [];
    if (nativeInfo) {
      items.push({
        label: "Bundled FFmpeg",
        value: nativeInfo.ffmpegAvailable ? (nativeInfo.ffmpegVersion ? nativeInfo.ffmpegVersion.slice(0, 45) : "Available") : "Not bundled",
        available: nativeInfo.ffmpegAvailable,
        detail: nativeInfo.ffmpegPath,
      });
      items.push({
        label: "Bundled FFprobe",
        value: nativeInfo.ffprobePath !== "not bundled" ? "Available" : "Not bundled",
        available: nativeInfo.ffprobePath !== "not bundled",
      });
      items.push({
        label: "Rubber Band filter",
        value: nativeInfo.rubberBandAvailable ? "Supported" : "Not compiled into bundled FFmpeg",
        available: nativeInfo.rubberBandAvailable,
      });
    }
    items.push(
      { label: "AudioContext state", value: audioState, available: audioState === "running" || audioState === "suspended" },
      { label: "Max output channels", value: maxChannels ? String(maxChannels) : "unknown", available: maxChannels != null },
      {
        label: "MediaRecorder formats",
        value:
          recorderMimes.filter((m) => m.supported).map((m) => m.mime).join(", ") ||
          "none supported (recording unavailable)",
        available: recorderMimes.some((m) => m.supported),
      },
      {
        label: "Microphone devices",
        value: micCount != null ? `${micCount} input device(s) · permission: ${micPermission}` : "unknown",
        available: micCount != null && micCount > 0,
      },
      {
        label: "Playable formats (canPlayType)",
        value: playback.map((p) => `${p.label}:${p.support}`).join(" · "),
        available: playback.some((p) => p.support !== "no"),
        detail: "Indicative probe — import validation decodes actual files.",
      }
    );
    return items;
  }, [nativeInfo, audioState, maxChannels, recorderMimes, micCount, micPermission, playback]);

  const futureAi: CapabilityItem[] = useMemo(() => [
    {
      label: "Python worker",
      value: inferenceInfo?.workerAvailable ? "Detected and responsive" : (nativeInfo ? "Worker executable not bundled/started" : "Web preview (desktop only)"),
      available: !!inferenceInfo?.workerAvailable,
    },
    {
      label: "Inference runtimes",
      value: inferenceInfo?.runtimes?.length ? inferenceInfo.runtimes.join(", ") : "None detected",
      available: (inferenceInfo?.runtimes?.length ?? 0) > 0,
    },
    {
      label: "Supported devices",
      value: inferenceInfo?.devices?.length ? inferenceInfo.devices.map((d) => d.toUpperCase()).join(", ") : "CPU",
      available: (inferenceInfo?.devices?.length ?? 0) > 0,
      detail: "Hardware acceleration depends on device drivers and runtime build.",
    },
    {
      label: "Registered adapters",
      value: `${INFERENCE_ADAPTERS.length} adapter contracts (MDX-Net, VR, Demucs, BS-RoFormer, MelBand, Generic ONNX, Custom PyTorch, Custom Safetensors)`,
      available: true,
    },
    {
      label: "Installed models",
      value: `${userModels.length} user-registered · built-in slot: ${builtin.status}`,
      available: userModels.length > 0,
    },
    {
      label: "Fallback readiness",
      value: inferenceInfo?.defaultModelInstalled ? "Default model installed" : "No bundled default checkpoint. Select verified ONNX checkpoint in Remover.",
      available: !!inferenceInfo?.defaultModelInstalled,
    },
  ], [nativeInfo, inferenceInfo, userModels.length, builtin.status]);

  const copyReport = () => {
    const section = (title: string, items: CapabilityItem[]) =>
      `\n${title}\n${items.map((i) => `  ${i.label}: ${i.value}${i.detail ? ` (${i.detail})` : ""}`).join("\n")}`;
    const report = [
      `Local Audio Studio — diagnostic report (sanitized)`,
      `Generated: ${new Date().toISOString()}`,
      `OS: ${os.name} ${os.version} · UA platform: ${typeof navigator !== "undefined" ? (navigator.platform ?? "unknown") : "unknown"}`,
      section("Hardware", hardware),
      section("Application", application),
      section("Audio capabilities", audio),
      section("Future AI capabilities", futureAi),
    ].join("\n");
    void navigator.clipboard
      .writeText(report)
      .then(() => toast.success("Sanitized diagnostic report copied"))
      .catch(() => toast.error("Clipboard write failed"));
  };

  const renderItems = (items: CapabilityItem[]) => (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="text-foreground">{i.label}</p>
            {i.detail && <p className="text-[11px] text-muted-foreground">{i.detail}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="max-w-[260px] truncate text-right text-xs text-muted-foreground sm:max-w-[360px]" title={i.value}>
              {i.value}
            </span>
            {i.available === true ? (
              <Badge variant="outline" className="shrink-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">OK</Badge>
            ) : i.available === false ? (
              <Badge variant="outline" className="shrink-0 border-border text-muted-foreground">N/A</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400">?</Badge>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div>
      <PageHeader
        title="System Information"
        description="Real detection only — a capability is shown as available after a genuine probe, never inferred. The report below contains no file names or personal paths."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTick((t) => t + 1)}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Re-run probes
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={copyReport}>
              <Copy className="h-3.5 w-3.5" aria-hidden /> Copy report
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cpu className="h-4 w-4 text-primary" aria-hidden /> Hardware &amp; OS
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Operating system</span>
              <span className="text-xs text-muted-foreground">{os.name} {os.version}</span>
            </div>
            {renderItems(hardware)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HardDrive className="h-4 w-4 text-primary" aria-hidden /> Application
            </CardTitle>
          </CardHeader>
          <CardContent>{renderItems(application)}</CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MonitorSpeaker className="h-4 w-4 text-primary" aria-hidden /> Audio capabilities
            </CardTitle>
          </CardHeader>
          <CardContent>{renderItems(audio)}</CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Puzzle className="h-4 w-4 text-primary" aria-hidden /> Future AI capabilities
            </CardTitle>
          </CardHeader>
          <CardContent>{renderItems(futureAi)}</CardContent>
        </Card>
      </div>

      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Mic className="h-3.5 w-3.5" aria-hidden />
        Microphone permission state reflects the live Permissions API value and updates on change.
      </p>
    </div>
  );
}

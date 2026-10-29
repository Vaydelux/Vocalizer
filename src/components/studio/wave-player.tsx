"use client";

/**
 * Shared audio player built on WaveSurfer v8.
 *
 * - One WaveSurfer instance per mount; fully destroyed on unmount/track change
 *   (no duplicate audio elements, no leaked listeners).
 * - Waveform peaks are computed from real decoded audio and cached per track.
 * - Optional single selection region (drag to create, or set programmatically).
 * - Transport: play/pause/stop, seek, volume/mute, time display, zoom, loop region.
 * - Keyboard shortcuts (ignored while typing): Space, ←/→ (±2s, Shift ±10s),
 *   M mute, L loop, I/O set region start/end at playhead.
 */

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardRefRenderFunction,
} from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import type { Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import {
  ChevronFirst,
  CircleStop,
  Repeat,
  Play,
  Pause,
  Scissors,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useSettings } from "@/lib/studio/store-settings";
import { cachePeaks, computePeaks, getCachedPeaks, type Peaks } from "@/lib/studio/peaks";
import { formatTime } from "@/lib/studio/format";
import type { AudioTrack } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

export interface RegionRange {
  start: number;
  end: number;
}

export interface WavePlayerHandle {
  setRegion: (range: RegionRange | null) => void;
  getRegion: () => RegionRange | null;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  playRegion: () => void;
}

interface Props {
  track: AudioTrack;
  height?: number;
  withRegion?: boolean;
  onRegionChange?: (range: RegionRange | null) => void;
  onLoopChange?: (loop: boolean) => void;
  /** Optional per-tick playback position (used for synced lyrics). */
  onTimeChange?: (t: number) => void;
  className?: string;
}

const ACCENT = "#8b5cf6"; // violet-500

const WavePlayerImpl: ForwardRefRenderFunction<WavePlayerHandle, Props> = (
  { track, height = 128, withRegion = false, onRegionChange, onLoopChange, onTimeChange, className },
  ref
) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const regionRef = useRef<Region | null>(null);
  const regionRangeRef = useRef<RegionRange | null>(null);
  const loopRef = useRef(false);
  const disposeDragRef = useRef<(() => void) | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => useSettings.getState().volume);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [region, setRegionState] = useState<RegionRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0); // 0 = fit to width

  /* ------------------------------- ws lifecycle ------------------------------ */
  useEffect(() => {
    let cancelled = false;
    let ws: WaveSurfer | null = null;

    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setRegionState(null);
    setRegionAndNotify(null);
    setError(null);
    setZoom(0);
    regionRef.current = null;
    regionRangeRef.current = null;
    loopRef.current = false;
    setLoop(false);

    async function setup(): Promise<void> {
      if (!containerRef.current) return;
      const [{ default: WaveSurferCtor }, { default: RegionsPluginCtor }] = await Promise.all([
        import("wavesurfer.js"),
        import("wavesurfer.js/dist/plugins/regions.esm.js"),
      ]);
      if (cancelled || !containerRef.current) return;

      const cached = getCachedPeaks(track.id);
      const peaksParam = cached
        ? cached.channels.map((c) => Array.from(c))
        : undefined;

      ws = WaveSurferCtor.create({
        container: containerRef.current,
        height,
        waveColor: "#52525b",
        progressColor: ACCENT,
        cursorColor: "#a78bfa",
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        url: track.url,
        peaks: peaksParam,
        duration: cached ? cached.duration : undefined,
      });
      wsRef.current = ws;

      if (withRegion) {
        const regions = ws.registerPlugin(RegionsPluginCtor.create());
        regionsRef.current = regions;
        disposeDragRef.current = regions.enableDragSelection(
          {
            color: "rgba(139, 92, 246, 0.22)",
          },
          2
        );
        regions.on("region-updated", (r: Region) => {
          if (r !== regionRef.current) return;
          const range = { start: r.start, end: r.end };
          regionRangeRef.current = range;
          setRegionState(range);
          onRegionChange?.(range);
        });
      }

      ws.on("ready", (dur: number) => {
        if (cancelled) return;
        setReady(true);
        setDuration(dur);
        ws?.setVolume(muted ? 0 : volume);
        // Cache peaks from the freshly decoded data for future loads.
        const data = ws?.getDecodedData();
        if (data && !getCachedPeaks(track.id)) {
          void computePeaks(data)
            .then((p: Peaks) => {
              if (!cancelled) cachePeaks(track.id, p);
            })
            .catch(() => {
              /* peak caching is an optimization; failures are non-fatal */
            });
        }
      });
      ws.on("decode", () => {
        if (cancelled) return;
        setReady(true);
      });
      ws.on("play", () => !cancelled && setPlaying(true));
      ws.on("pause", () => !cancelled && setPlaying(false));
      ws.on("finish", () => !cancelled && setPlaying(false));
      ws.on("timeupdate", (t: number) => {
        if (cancelled) return;
        setCurrentTime(t);
        onTimeChange?.(t);
        // Loop over the selected region.
        const range = regionRangeRef.current;
        if (loopRef.current && range && t >= range.end) {
          ws?.setTime(range.start);
        }
      });
      ws.on("error", (err: Error) => {
        if (cancelled) return;
        setError(err?.message || "Audio could not be loaded or decoded.");
      });
    }

    void setup();

    return () => {
      cancelled = true;
      disposeDragRef.current?.();
      disposeDragRef.current = null;
      ws?.destroy();
      if (wsRef.current === ws) wsRef.current = null;
      regionsRef.current = null;
      regionRef.current = null;
    };
  }, [track.id, withRegion, height]);

  function setRegionAndNotify(range: RegionRange | null): void {
    regionRangeRef.current = range;
    setRegionState(range);
    onRegionChange?.(range);
  }

  /* --------------------------------- controls -------------------------------- */

  const togglePlay = useCallback(() => {
    void wsRef.current?.playPause();
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.stop();
    ws.setTime(0);
    setCurrentTime(0);
  }, []);

  const seek = useCallback((t: number) => {
    wsRef.current?.setTime(Math.max(0, t));
  }, []);

  const playRegion = useCallback(() => {
    const ws = wsRef.current;
    const range = regionRangeRef.current;
    if (!ws || !range) return;
    ws.setTime(range.start);
    void ws.play();
  }, []);

  const setRegion = useCallback(
    (range: RegionRange | null) => {
      const regions = regionsRef.current;
      const ws = wsRef.current;
      if (!regions || !ws) return;
      regions.clearRegions();
      regionRef.current = null;
      if (!range) {
        setRegionAndNotify(null);
        return;
      }
      const dur = ws.getDuration() || 0;
      const clamped: RegionRange = {
        start: Math.max(0, Math.min(range.start, dur)),
        end: Math.max(0, Math.min(range.end, dur)),
      };
      if (clamped.end - clamped.start < 0.01) return;
      const r = regions.addRegion({
        start: clamped.start,
        end: clamped.end,
        color: "rgba(139, 92, 246, 0.22)",
        drag: true,
        resize: true,
      });
      regionRef.current = r;
      setRegionAndNotify(clamped);
    },
    // setRegionAndNotify is a stable module-scope-ish closure using setState only.
    []
  );

  const toggleLoop = useCallback(() => {
    setLoop((prev) => {
      const next = !prev;
      loopRef.current = next;
      onLoopChange?.(next);
      return next;
    });
  }, [onLoopChange]);

  const changeZoom = useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const base = z === 0 ? 24 : z;
      const next = Math.max(6, Math.min(400, base * (dir === 1 ? 1.6 : 1 / 1.6)));
      try {
        wsRef.current?.zoom(next);
      } catch {
        /* zoom can throw if waveform not ready */
      }
      return next;
    });
  }, []);

  const fitZoom = useCallback(() => {
    try {
      wsRef.current?.zoom(0);
    } catch {
      /* noop */
    }
    setZoom(0);
  }, []);

  const applyVolume = useCallback((v: number) => {
    setVolume(v);
    setMuted(v === 0);
    wsRef.current?.setVolume(v);
    useSettings.getState().update({ volume: v });
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      wsRef.current?.setMuted(!m);
      return !m;
    });
  }, []);

  /* ----------------------------- keyboard shortcuts --------------------------- */
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable ||
        t.getAttribute("role") === "combobox"
      );
    };
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target) || !wsRef.current) return;
      const step = e.shiftKey ? 10 : 2;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(Math.min(duration, wsRef.current.getCurrentTime() + step));
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(Math.max(0, wsRef.current.getCurrentTime() - step));
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "l":
        case "L":
          if (withRegion && regionRangeRef.current) toggleLoop();
          break;
        case "i":
        case "I":
          if (withRegion) {
            const t = wsRef.current?.getCurrentTime() ?? 0;
            const cur = regionRangeRef.current;
            setRegion({ start: t, end: cur ? Math.max(cur.end, t + 0.05) : Math.min(duration, t + 5) });
          }
          break;
        case "o":
        case "O":
          if (withRegion) {
            const t = wsRef.current?.getCurrentTime() ?? 0;
            const cur = regionRangeRef.current;
            setRegion({ start: cur ? Math.min(cur.start, Math.max(0, t - 0.05)) : 0, end: t });
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek, toggleMute, toggleLoop, withRegion, duration, setRegion]);

  useImperativeHandle(
    ref,
    () => ({
      setRegion,
      getRegion: () => regionRangeRef.current,
      seek,
      play: () => void wsRef.current?.play(),
      pause: () => void wsRef.current?.pause(),
      stop,
      playRegion,
    }),
    [setRegion, seek, stop, playRegion]
  );

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="relative px-4 pt-4">
        <div ref={containerRef} className="min-h-[64px] w-full" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center rounded-b-xl bg-card/70">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-pulse rounded-full bg-primary" aria-hidden />
              Decoding audio…
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center rounded-b-xl bg-card/90 p-4 text-center">
            <p className="text-xs text-destructive">Audio error: {error}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-3">
        <Button
          variant="secondary"
          size="icon"
          aria-label={playing ? "Pause" : "Play"}
          onClick={togglePlay}
          disabled={!ready || !!error}
          className="h-9 w-9 text-primary hover:text-primary"
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Stop" onClick={stop} disabled={!ready} className="h-9 w-9">
          <CircleStop className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to start"
          onClick={() => seek(0)}
          disabled={!ready}
          className="h-9 w-9"
        >
          <ChevronFirst className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back 2 seconds"
          onClick={() => seek(Math.max(0, currentTime - 2))}
          disabled={!ready}
          className="hidden h-9 w-9 sm:inline-flex"
        >
          <SkipBack className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Forward 2 seconds"
          onClick={() => seek(Math.min(duration, currentTime + 2))}
          disabled={!ready}
          className="hidden h-9 w-9 sm:inline-flex"
        >
          <SkipForward className="h-4 w-4" aria-hidden />
        </Button>

        <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground" aria-live="off">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {withRegion && region && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={playRegion}
              disabled={!ready}
              className="h-8 gap-1.5 text-xs"
              aria-label="Play selection"
            >
              <Scissors className="h-3.5 w-3.5" aria-hidden /> Play selection
            </Button>
            <Button
              variant={loop ? "secondary" : "ghost"}
              size="sm"
              onClick={toggleLoop}
              disabled={!ready}
              className={cn("h-8 gap-1.5 text-xs", loop && "text-primary")}
              aria-pressed={loop}
              aria-label="Loop selection"
            >
              <Repeat className="h-3.5 w-3.5" aria-hidden /> Loop
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={toggleMute}
            className="h-9 w-9"
          >
            <VolIcon className="h-4 w-4" aria-hidden />
          </Button>
          <Slider
            aria-label="Volume"
            value={[muted ? 0 : volume]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(v) => applyVolume(v[0] ?? 0)}
            className="w-20 sm:w-24"
          />
          <div className="ml-1 hidden items-center gap-1 md:flex">
            <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => changeZoom(-1)} className="h-8 w-8">
              <ZoomOut className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Fit waveform" onClick={fitZoom} className="h-8 w-8">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => changeZoom(1)} className="h-8 w-8">
              <ZoomIn className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const WavePlayer = React.forwardRef(WavePlayerImpl);

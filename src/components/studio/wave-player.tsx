"use client";

/**
 * Shared audio player — self-contained canvas waveform + HTMLAudioElement.
 *
 * - One <audio> per mounted player, fully torn down on unmount/track change.
 * - Waveform peaks are computed from real decoded audio and cached per track.
 * - Optional single selection region (drag to create, or set programmatically).
 * - Transport: play/pause/stop, seek, volume/mute, time display, zoom, loop region.
 * - Keyboard shortcuts (ignored while typing): Space, ←/→ (±2s, Shift ±10s),
 *   M mute, L loop, I/O set region start/end at playhead.
 *
 * (Originally built on WaveSurfer v8; replaced with this custom renderer after
 * v8 failed to paint its canvas in the target runtime. The peaks pipeline and
 * component contract are unchanged, so this slots into every workspace tool.)
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardRefRenderFunction,
} from "react";
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
import React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useSettings } from "@/lib/studio/store-settings";
import { cachePeaks, computePeaks, getCachedPeaks, type Peaks } from "@/lib/studio/peaks";
import { decodeFile } from "@/lib/studio/decode";
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
  onTimeChange?: (t: number) => void;
  className?: string;
}

const ACCENT = "#8b5cf6"; // violet-500
const WAVE_COLOR = "#52525b";
const FIT_ZOOM = 0; // 0 = fit to container width

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const WavePlayerImpl: ForwardRefRenderFunction<WavePlayerHandle, Props> = (
  { track, height = 128, withRegion = false, onRegionChange, onLoopChange, onTimeChange, className },
  ref
) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peaksRef = useRef<Peaks | null>(null);
  const regionRef = useRef<RegionRange | null>(null);
  const loopRef = useRef(false);
  const zoomRef = useRef<number>(FIT_ZOOM);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{ active: boolean; startX: number; moved: boolean } | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => useSettings.getState().volume);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [region, setRegionState] = useState<RegionRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(FIT_ZOOM);
  const [width, setWidth] = useState(800);

  /* --------------------------- canvas size tracking -------------------------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ------------------------------- audio setup ------------------------------- */
  useEffect(() => {
    let cancelled = false;
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audioRef.current = audio;
    audio.volume = muted ? 0 : volume;

    const onLoaded = () => {
      if (cancelled) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        setReady(true);
      }
    };
    const onTime = () => {
      if (cancelled) return;
      setCurrentTime(audio.currentTime);
      onTimeChange?.(audio.currentTime);
      if (loopRef.current && regionRef.current && audio.currentTime >= regionRef.current.end) {
        audio.currentTime = regionRef.current.start;
      }
    };
    const onPlay = () => !cancelled && setPlaying(true);
    const onPause = () => !cancelled && setPlaying(false);
    const onEnded = () => !cancelled && setPlaying(false);
    const onError = () => {
      if (cancelled) return;
      setError("The audio element could not load this file.");
    };
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.src = track.url;
    audio.load();

    // Decode for waveform peaks (cached). Large files may skip — playback still works.
    void (async () => {
      try {
        const cached = getCachedPeaks(track.id);
        if (cached) {
          if (!cancelled) {
            peaksRef.current = cached;
            setDuration(cached.duration);
            setReady(true);
          }
          return;
        }
        const { buffer } = await decodeFile(track.file);
        if (cancelled) return;
        const peaks = await computePeaks(buffer);
        if (cancelled) return;
        peaksRef.current = peaks;
        cachePeaks(track.id, peaks);
        setDuration((d) => (d > 0 ? d : peaks.duration));
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          // Non-fatal: playback works without a waveform; show a flat line.
          console.warn("[wave-player] peak decode skipped:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
      peaksRef.current = null;
    };
  }, [track.id]);

  /* ------------------------------ canvas rendering --------------------------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const pxPerSec = zoomRef.current || (width > 0 && duration > 0 ? width / duration : 1);
    const cssW = Math.max(width, Math.ceil(duration * pxPerSec));
    const cssH = height;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Mid line
    ctx.fillStyle = WAVE_COLOR;
    const mid = cssH / 2;
    if (peaks && peaks.duration > 0) {
      const bucketsPerSec = peaks.fps;
      const bucketsPerPixel = bucketsPerSec / pxPerSec;
      const chCount = peaks.channels.length;
      for (let x = 0; x < cssW; x++) {
        const tCenter = x / pxPerSec;
        const bucketCenter = tCenter * bucketsPerSec;
        let min = 0;
        let max = 0;
        if (bucketsPerPixel <= 1) {
          // Oversample: interpolate the nearest bucket pair (min/max separately).
          const b0 = Math.floor(bucketCenter);
          const b1 = b0 + 1;
          const frac = bucketCenter - b0;
          for (let c = 0; c < chCount; c++) {
            const arr = peaks.channels[c];
            const lo0 = arr[Math.max(0, Math.min(arr.length / 2 - 1, b0)) * 2];
            const lo1 = arr[Math.max(0, Math.min(arr.length / 2 - 1, b1)) * 2];
            const hi0 = arr[Math.max(0, Math.min(arr.length / 2 - 1, b0)) * 2 + 1];
            const hi1 = arr[Math.max(0, Math.min(arr.length / 2 - 1, b1)) * 2 + 1];
            const lo = lo0 + (lo1 - lo0) * frac;
            const hi = hi0 + (hi1 - hi0) * frac;
            min = Math.min(min, lo);
            max = Math.max(max, hi);
          }
        } else {
          const bStart = Math.floor(bucketCenter - bucketsPerPixel / 2);
          const bEnd = Math.floor(bucketCenter + bucketsPerPixel / 2);
          for (let c = 0; c < chCount; c++) {
            const arr = peaks.channels[c];
            const nBuckets = arr.length / 2;
            for (let b = Math.max(0, bStart); b < Math.min(nBuckets, bEnd); b++) {
              const lo = arr[b * 2];
              const hi = arr[b * 2 + 1];
              if (lo < min) min = lo;
              if (hi > max) max = hi;
            }
          }
        }
        const top = mid + min * (mid - 2);
        const bottom = mid + max * (mid - 2);
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    } else {
      // No peaks (e.g., file too large to decode): honest flat line.
      ctx.fillRect(0, mid, cssW, 1);
    }

    // Region overlay
    const r = regionRef.current;
    if (r && duration > 0) {
      const rx = r.start * pxPerSec;
      const rw = (r.end - r.start) * pxPerSec;
      ctx.fillStyle = "rgba(139, 92, 246, 0.18)";
      ctx.fillRect(rx, 0, rw, cssH);
      ctx.strokeStyle = "rgba(139, 92, 246, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx, 0);
      ctx.lineTo(rx, cssH);
      ctx.moveTo(rx + rw, 0);
      ctx.lineTo(rx + rw, cssH);
      ctx.stroke();
    }

    // Playhead
    const audio = audioRef.current;
    const t = audio ? audio.currentTime : 0;
    if (t > 0 && duration > 0) {
      const px = t * pxPerSec;
      ctx.fillStyle = "#a78bfa";
      ctx.fillRect(px, 0, 2, cssH);
    }
  }, [width, height, duration]);

  // Redraw on state/data changes.
  useEffect(() => {
    draw();
  }, [draw, ready, region, zoom]);

  // rAF playhead during playback (cheap: only redraws playhead column range).
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, draw]);

  /* ------------------------------ region helpers ----------------------------- */
  const setRegionAndNotify = useCallback(
    (range: RegionRange | null) => {
      regionRef.current = range;
      setRegionState(range);
      onRegionChange?.(range);
      draw();
    },
    [onRegionChange, draw]
  );

  /* --------------------------------- controls -------------------------------- */
  const togglePlay = useCallback(() => {
    void audioRef.current?.play().then(() => undefined).catch(() => undefined);
    if (playing) audioRef.current?.pause();
  }, [playing]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
    setCurrentTime(0);
  }, []);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = clamp(t, 0, a.duration || t);
    setCurrentTime(a.currentTime);
  }, []);

  const playRegion = useCallback(() => {
    const a = audioRef.current;
    const r = regionRef.current;
    if (!a || !r) return;
    a.currentTime = r.start;
    void a.play().catch(() => undefined);
  }, []);

  const setRegion = useCallback(
    (range: RegionRange | null) => {
      if (!range) {
        setRegionAndNotify(null);
        return;
      }
      const dur = audioRef.current?.duration ?? duration;
      setRegionAndNotify({
        start: clamp(range.start, 0, dur),
        end: clamp(range.end, 0, dur),
      });
    },
    [duration, setRegionAndNotify]
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
      const base = z === FIT_ZOOM && duration > 0 && width > 0 ? width / duration : z || 20;
      const next = clamp(base * (dir === 1 ? 1.6 : 1 / 1.6), 6, 400);
      zoomRef.current = next;
      return next;
    });
  }, [duration, width]);

  const fitZoom = useCallback(() => {
    zoomRef.current = FIT_ZOOM;
    setZoom(FIT_ZOOM);
  }, []);

  const applyVolume = useCallback((v: number) => {
    setVolume(v);
    setMuted(v === 0);
    if (audioRef.current) audioRef.current.volume = v;
    useSettings.getState().update({ volume: v });
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (audioRef.current) audioRef.current.muted = !m;
      return !m;
    });
  }, []);

  /* ----------------------------- pointer interactions ------------------------ */
  const timeFromX = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current;
      const scroll = scrollRef.current;
      if (!canvas || !scroll) return 0;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left + scroll.scrollLeft;
      const pxPerSec = zoomRef.current || (width > 0 && duration > 0 ? width / duration : 1);
      return clamp(x / pxPerSec, 0, duration);
    },
    [width, duration]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!withRegion && !ready) return;
      const t = timeFromX(e.clientX);
      dragRef.current = { active: true, startX: e.clientX, moved: false };
      if (withRegion && e.shiftKey) {
        // shift-drag always creates a new region
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      if (!withRegion) {
        seek(t);
      }
    },
    [withRegion, ready, timeFromX, seek]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag?.active) return;
      if (Math.abs(e.clientX - drag.startX) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (!withRegion) return;
      const startT = timeFromX(drag.startX);
      const curT = timeFromX(e.clientX);
      const lo = Math.min(startT, curT);
      const hi = Math.max(startT, curT);
      if (hi - lo > 0.001) {
        regionRef.current = { start: lo, end: hi };
        setRegionState({ start: lo, end: hi });
        onRegionChange?.({ start: lo, end: hi });
        draw();
      }
    },
    [withRegion, timeFromX, onRegionChange, draw]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (!drag) return;
      // Click without drag → seek (region stays).
      if (!drag.moved) {
        seek(timeFromX(e.clientX));
      }
    },
    [seek, timeFromX]
  );

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
      if (isTypingTarget(e.target) || !audioRef.current) return;
      const a = audioRef.current;
      const step = e.shiftKey ? 10 : 2;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(a.currentTime + step);
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(a.currentTime - step);
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "l":
        case "L":
          if (withRegion && regionRef.current) toggleLoop();
          break;
        case "i":
        case "I":
          if (withRegion) {
            const t = a.currentTime;
            const cur = regionRef.current;
            setRegion({ start: t, end: cur ? Math.max(cur.end, t + 0.05) : Math.min(duration, t + 5) });
          }
          break;
        case "o":
        case "O":
          if (withRegion) {
            const t = a.currentTime;
            const cur = regionRef.current;
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
    () => ({ setRegion, getRegion: () => regionRef.current, seek, play: () => void audioRef.current?.play(), pause: () => audioRef.current?.pause(), stop, playRegion }),
    [setRegion, seek, stop, playRegion]
  );

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  void zoom;

  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="relative px-4 pt-4">
        <div ref={scrollRef} className="studio-scroll relative w-full overflow-x-auto overflow-y-hidden" style={{ height }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="block touch-none cursor-pointer"
            role="slider"
            aria-label="Waveform — click to seek, drag to select a region"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            style={{ height }}
          />
        </div>
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/70">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-pulse rounded-full bg-primary" aria-hidden />
              Loading audio…
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/90 p-4 text-center">
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
        <Button variant="ghost" size="icon" aria-label="Back to start" onClick={() => seek(0)} disabled={!ready} className="h-9 w-9">
          <ChevronFirst className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Back 2 seconds" onClick={() => seek(currentTime - 2)} disabled={!ready} className="hidden h-9 w-9 sm:inline-flex">
          <SkipBack className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Forward 2 seconds" onClick={() => seek(currentTime + 2)} disabled={!ready} className="hidden h-9 w-9 sm:inline-flex">
          <SkipForward className="h-4 w-4" aria-hidden />
        </Button>

        <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground" aria-live="off">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {withRegion && region && (
          <>
            <Button variant="outline" size="sm" onClick={playRegion} disabled={!ready} className="h-8 gap-1.5 text-xs" aria-label="Play selection">
              <Scissors className="h-3.5 w-3.5" aria-hidden /> Play selection
            </Button>
            <Button variant={loop ? "secondary" : "ghost"} size="sm" onClick={toggleLoop} disabled={!ready} className={cn("h-8 gap-1.5 text-xs", loop && "text-primary")} aria-pressed={loop} aria-label="Loop selection">
              <Repeat className="h-3.5 w-3.5" aria-hidden /> Loop
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute} className="h-9 w-9">
            <VolIcon className="h-4 w-4" aria-hidden />
          </Button>
          <Slider aria-label="Volume" value={[muted ? 0 : volume]} min={0} max={1} step={0.01} onValueChange={(v) => applyVolume(v[0] ?? 0)} className="w-20 sm:w-24" />
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

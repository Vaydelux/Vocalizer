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
  useMemo,
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
import { native, isNative } from "@/lib/studio/native";
import { planWaveformViewport, waveformTimeAtPointer } from "@/lib/studio/waveform-viewport";
import { planWaveformRaster } from "@/lib/studio/waveform-raster";
import { mayComputeFullWaveform, shouldPreloadMetadataOnly } from "@/lib/studio/waveform-policy";
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

/** The two overlaid canvases share exact bitmaps and CSS dimensions. */
function prepareCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const raster = planWaveformRaster(cssW, cssH, window.devicePixelRatio || 1);
  // Updating canvas dimensions resets the bitmap. Never do so on every
  // animation frame when only the playhead has moved.
  if (canvas.width !== raster.width) canvas.width = raster.width;
  if (canvas.height !== raster.height) canvas.height = raster.height;
  if (canvas.style.width !== `${cssW}px`) canvas.style.width = `${cssW}px`;
  if (canvas.style.height !== `${cssH}px`) canvas.style.height = `${cssH}px`;
  ctx.setTransform(raster.scale, 0, 0, raster.scale, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

const WavePlayerImpl: ForwardRefRenderFunction<WavePlayerHandle, Props> = (
  { track, height = 128, withRegion = false, onRegionChange, onLoopChange, onTimeChange, className },
  ref
) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peaksRef = useRef<Peaks | null>(null);
  const regionRef = useRef<RegionRange | null>(null);
  const loopRef = useRef(false);
  const rafRef = useRef<number>(0);
  const scrollRafRef = useRef<number>(0);
  const dragRef = useRef<{ active: boolean; startX: number; moved: boolean } | null>(null);

  const [ready, setReady] = useState(false);
  const [peakVersion, setPeakVersion] = useState(0);
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
  const viewport = useMemo(
    () => planWaveformViewport(duration, width, zoom),
    [duration, width, zoom],
  );

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
    // A discarded player must stop incremental peak work, not just ignore it.
    const peakAbort = new AbortController();
    let nativePeakStarted = false;
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = shouldPreloadMetadataOnly(track) ? "metadata" : "auto";
    audioRef.current = audio;
    audio.volume = muted ? 0 : volume;

    const onLoadStart = () => {
      if (cancelled) return;
      setError(null);
      setReady(false);
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    };
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
      setPlaying(false);
      setReady(false);
      setError("This file could not be played. Try re-importing it, or convert it to WAV.");
    };
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    peaksRef.current = null;
    audio.src = track.url;
    audio.load();

    // Decode for waveform peaks (cached). Large files may skip — playback still works.
    void (async () => {
      try {
        const cached = getCachedPeaks(track.id, track.url);
        if (cached) {
          if (!cancelled) {
            peaksRef.current = cached;
            setPeakVersion((v) => v + 1);
            setDuration(cached.duration);
            setReady(true);
          }
          return;
        }
        // Native published stems use main-owned FFmpeg decoding. Only bounded
        // float32 min/max envelopes cross IPC, never full decoded PCM.
        if (track.nativeStem && isNative()) {
          const api = native();
          if (!api) return;
          nativePeakStarted = true;
          const result = await api.generateInferenceWaveform(track.nativeStem);
          if (cancelled || peakAbort.signal.aborted) return;
          const ordered = [...result.levels].sort((a, b) => b.fps - a.fps);
          if (ordered.length !== 3 || ordered.some(level =>
            !Number.isFinite(level.fps) || level.fps <= 0 ||
            !Number.isSafeInteger(level.buckets) || level.buckets < 1 ||
            level.minMax.length !== level.buckets * 2
          )) throw new Error("The native waveform response is invalid.");
          const toPeaks = (level: typeof ordered[number]): Peaks => ({
            channels: [new Float32Array(level.minMax)],
            buckets: level.buckets,
            fps: level.fps,
            duration: result.duration,
            sampleRate: result.sampleRate,
          });
          const peaks = toPeaks(ordered[0]);
          peaks.overviewLevels = ordered.slice(1).map(toPeaks);
          peaksRef.current = peaks;
          cachePeaks(track.id, peaks, track.url);
          setPeakVersion(v => v + 1);
          return;
        }
        // Normal browser preview continues using the conservative PCM budget.
        if (!mayComputeFullWaveform(track)) return;
        const { buffer } = await decodeFile(track.file, peakAbort.signal);
        if (cancelled || peakAbort.signal.aborted) return;
        const peaks = await computePeaks(buffer, peakAbort.signal);
        if (cancelled || peakAbort.signal.aborted) return;
        peaksRef.current = peaks;
        cachePeaks(track.id, peaks, track.url);
        setPeakVersion((v) => v + 1);
        setDuration((d) => (d > 0 ? d : peaks.duration));
        setReady(true);
      } catch (err) {
        if (!cancelled && !peakAbort.signal.aborted) {
          // Non-fatal: playback works without a waveform; show a flat line.
          console.warn("[wave-player] peak decode skipped:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      peakAbort.abort();
      if (nativePeakStarted && track.nativeStem) {
        void native()?.cancelInferenceWaveform(track.nativeStem).catch(() => { /* closed */ });
      }
      cancelAnimationFrame(rafRef.current);
      audio.removeEventListener("loadstart", onLoadStart);
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
  }, [track.id, track.url]); // Relinked project tracks preserve ID but receive a new media URL.

  /* ------------------------------ layered waveform rendering --------------------------- */
  // Static peaks are repainted only on source, zoom, resize or scroll changes.
  // Playhead/selection uses its own transparent canvas for cheap 60 Hz updates.
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = viewport.viewportWidth;
    const cssH = height;
    const ctx = prepareCanvas(canvas, cssW, cssH);
    if (!ctx) return;
    const stored = peaksRef.current;
    const pxPerSec = viewport.pixelsPerSecond;
    const peaks = stored?.overviewLevels
      ? [...stored.overviewLevels, stored]
        .sort((a, b) => a.fps - b.fps)
        .find(level => level.fps >= pxPerSec) ?? stored
      : stored;
    const scrollX = scrollRef.current?.scrollLeft ?? 0;
    // Mid line
    ctx.fillStyle = WAVE_COLOR;
    const mid = cssH / 2;
    if (peaks && peaks.duration > 0) {
      const bucketsPerSec = peaks.fps;
      const bucketsPerPixel = bucketsPerSec / pxPerSec;
      const chCount = peaks.channels.length;
      for (let x = 0; x < cssW; x++) {
        const tCenter = (x + scrollX) / pxPerSec;
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
  }, [viewport, height]);

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const cssW = viewport.viewportWidth;
    const cssH = height;
    const ctx = prepareCanvas(canvas, cssW, cssH);
    if (!ctx) return;
    const pxPerSec = viewport.pixelsPerSecond;
    const scrollX = scrollRef.current?.scrollLeft ?? 0;
    // Region overlay
    const r = regionRef.current;
    if (r && duration > 0) {
      const rx = r.start * pxPerSec - scrollX;
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
      const px = t * pxPerSec - scrollX;
      ctx.fillStyle = "#a78bfa";
      ctx.fillRect(px, 0, 2, cssH);
    }
  }, [viewport, height, duration]);

  const draw = useCallback(() => {
    drawWaveform();
    drawOverlay();
  }, [drawWaveform, drawOverlay]);

  // Coalesce a burst of scroll events into one static viewport repaint/frame.
  const onViewportScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      draw();
    });
  }, [draw]);

  useEffect(() => () => cancelAnimationFrame(scrollRafRef.current), []);

  // Static peaks only change with source, cache, duration, zoom or viewport.
  // Selection dragging should never force a second full-peaks traversal.
  useEffect(() => {
    draw();
  }, [draw, ready, peakVersion]);

  // Region updates and pointer selection repaint only the cheap overlay.
  useEffect(() => {
    drawOverlay();
  }, [region, drawOverlay]);

  // Only the lightweight overlay updates every frame during playback.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      drawOverlay();
      return;
    }
    const tick = () => {
      drawOverlay();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, drawOverlay]);

  // Seeking while paused must update the playhead even without an rAF loop.
  useEffect(() => {
    if (!playing) drawOverlay();
  }, [currentTime, playing, drawOverlay]);

  /* ------------------------------ region helpers ----------------------------- */
  const setRegionAndNotify = useCallback(
    (range: RegionRange | null) => {
      regionRef.current = range;
      setRegionState(range);
      onRegionChange?.(range);
      drawOverlay();
    },
    [onRegionChange, drawOverlay]
  );

  /* --------------------------------- controls -------------------------------- */
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    void audio.play().catch((err: unknown) => {
      setPlaying(false);
      setError(err instanceof Error ? `Playback failed: ${err.message}` : "Audio playback was blocked.");
    });
  }, []);

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
    void a.play().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not play the selected region."));
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
      return next;
    });
  }, [duration, width]);

  const fitZoom = useCallback(() => {
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
      const canvas = overlayCanvasRef.current;
      const scroll = scrollRef.current;
      if (!canvas || !scroll) return 0;
      const rect = canvas.getBoundingClientRect();
      // The canvas rectangle already reflects horizontal scrolling.
      const x = clientX - rect.left;
      return waveformTimeAtPointer(x, scroll.scrollLeft, duration, viewport);
    },
    [duration, viewport]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!ready) return;
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
        drawOverlay();
      }
    },
    [withRegion, timeFromX, onRegionChange, drawOverlay]
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
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target) || !audioRef.current) return;
      // Only a focused player handles keyboard transport. Do not steal keys
      // from the rest of the application or from nested buttons/sliders.
      const active = document.activeElement;
      if (!active || !playerRef.current?.contains(active) ||
          (active instanceof HTMLElement && active.closest("button, [role='slider'], [role='dialog'], [role='menu']"))) {
        return;
      }
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

  return (
    <div ref={playerRef} className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="relative px-4 pt-4">
        <div ref={scrollRef} className="studio-scroll relative w-full overflow-x-auto overflow-y-hidden" style={{ height }} onScroll={onViewportScroll}>
          <div className="relative" style={{ width: viewport.timelineWidth, height }}>
            <div className="sticky left-0" style={{ width: viewport.viewportWidth, height }}>
              <canvas
                ref={canvasRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 block"
                style={{ height }}
              />
              <canvas
                ref={overlayCanvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="absolute inset-0 block touch-none cursor-pointer"
                role="slider"
                aria-label="Waveform — click to seek, drag to select a region"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(currentTime)}
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                tabIndex={ready ? 0 : -1}
                onKeyDown={(event) => {
                  if (!ready) return;
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    event.stopPropagation();
                    seek(currentTime + (event.key === "ArrowRight" ? 2 : -2));
                  } else if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    event.stopPropagation();
                    seek(event.key === "Home" ? 0 : duration);
                  }
                }}
                style={{ height }}
              />
            </div>
          </div>
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
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/90 p-4 text-center">
            <p className="text-xs text-destructive">Audio error: {error}</p>
            <Button size="sm" variant="outline" onClick={() => {
              const a = audioRef.current;
              if (!a) return;
              setError(null);
              a.load();
            }}>Retry playback</Button>
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

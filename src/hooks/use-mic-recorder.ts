"use client";

/**
 * Microphone recorder hook — real MediaRecorder pipeline shared by the
 * Recorder page and Karaoke workspace.
 *
 * Handles: device selection, permission failures with clear retry, pause/resume
 * when supported, elapsed time, input level metering, device-disconnect
 * recovery, and full cleanup (rAF, intervals, AudioContext, MediaStream).
 * Output is the raw recorded blob; format conversion is done by the caller
 * (e.g., decode → WAV export through the processing queue).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickRecorderMime } from "@/lib/studio/decode";
import { toStudioError } from "@/lib/studio/errors";
import { timestampSlug } from "@/lib/studio/format";

export type MicRecorderState = "idle" | "recording" | "paused" | "stopped";
export type MicPermission = "unknown" | "granted" | "denied";

export interface MicRecorderResult {
  blob: Blob;
  url: string;
  name: string;
  mime: string;
  durationSec: number;
}

export interface MicRecorder {
  state: MicRecorderState;
  permission: MicPermission;
  elapsedSec: number;
  level: number;
  error: { code: string; message: string } | null;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  mime: string | null;
  result: MicRecorderResult | null;
  selectDevice: (id: string) => void;
  start: () => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
}

export function useMicRecorder(): MicRecorder {
  const [state, setState] = useState<MicRecorderState>("idle");
  const [permission, setPermission] = useState<MicPermission>("unknown");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [result, setResult] = useState<MicRecorderResult | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resultUrlRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<number>(0);
  const startedAtRef = useRef(0);
  const accumulatedRef = useRef(0);
  const [activeMime, setActiveMime] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch {
      /* enumeration can fail pre-permission; devices list stays empty */
    }
  }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setLevel(0);
    const ctx = meterCtxRef.current;
    if (ctx) {
      void ctx.close();
      meterCtxRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    window.clearInterval(timerRef.current);
  }, []);

  const hardStop = useCallback(
    (deviceLost: boolean) => {
      stopTimer();
      stopMeter();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setState("idle");
      if (deviceLost) {
        setError({ code: "RECORDING_DEVICE_LOST", message: "The recording device was disconnected. Recording stopped — nothing was lost beyond the moment of disconnect." });
      }
    },
    [stopTimer, stopMeter]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === "audioinput"));
      } catch {
        /* enumeration can fail pre-permission; devices list stays empty */
      }
    };
    void run();
    const handler = () => {
      void run();
      // If our active input vanished while recording, surface it.
      if (streamRef.current) {
        const live = streamRef.current.getAudioTracks().some((t) => t.readyState === "live");
        if (!live && recorderRef.current?.state !== "inactive") {
          hardStop(true);
        }
      }
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, [refreshDevices, hardStop]);

  const start = useCallback(async () => {
    // A double-click during the permission prompt must not open two devices.
    if (startingRef.current || recorderRef.current?.state === "recording" ||
        recorderRef.current?.state === "paused") return false;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError({ code: "CAPABILITY_UNAVAILABLE", message: "Microphone capture is not supported by this environment." });
      return false;
    }
    const mime = pickRecorderMime();
    if (!mime) {
      setError({ code: "CAPABILITY_UNAVAILABLE", message: "MediaRecorder exposes no supported audio format in this browser." });
      return false;
    }
    setActiveMime(mime);
    startingRef.current = true;

    try {
      const audio = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId }, echoCancellation: false, noiseSuppression: false }
        : { echoCancellation: false, noiseSuppression: false };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;
      setPermission("granted");
      void refreshDevices();

      // Level metering through a dedicated AudioContext (closed on stop).
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        meterCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }

      const rec = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onerror = () => {
        setError({ code: "UNKNOWN", message: "The recorder reported an unexpected error. Capture stopped." });
        hardStop(false);
      };
      rec.start(250);

      startedAtRef.current = performance.now();
      accumulatedRef.current = 0;
      setElapsedSec(0);
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = null;
      }
      setResult(null);
      setState("recording");

      stopTimer();
      timerRef.current = window.setInterval(() => {
        if (recorderRef.current?.state === "recording") {
          setElapsedSec((accumulatedRef.current + (performance.now() - startedAtRef.current)) / 1000);
        }
      }, 200);

      // Device disconnect while recording.
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => hardStop(true);
      });
      return true;
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      stopMeter();
      stopTimer();
      setState("idle");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPermission("denied");
        setError({
          code: "MIC_PERMISSION_DENIED",
          message: "Microphone access was denied. Grant permission in the browser prompt (or site settings), then press Start again.",
        });
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setError({ code: "RECORDING_DEVICE_LOST", message: "No microphone was found. Connect an input device and try again." });
      } else {
        const e = toStudioError(err);
        setError({ code: e.code, message: e.message });
      }
      return false;
    } finally {
      startingRef.current = false;
    }
  }, [hardStop, refreshDevices, stopMeter, stopTimer, selectedDeviceId]);

  const pause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "recording") return;
    rec.pause();
    accumulatedRef.current += performance.now() - startedAtRef.current;
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "paused") return;
    rec.resume();
    startedAtRef.current = performance.now();
    setState("recording");
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    if (rec.state === "recording") {
      accumulatedRef.current += performance.now() - startedAtRef.current;
    }
    const durationSec = accumulatedRef.current / 1000;
    stopTimer();
    stopMeter();

    rec.onstop = () => {
      const mime = activeMime ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mime });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setState("stopped");
      setLevel(0);
      if (blob.size === 0) {
        setError({ code: "OUTPUT_EMPTY", message: "The recorder produced an empty file. Try again." });
        setState("idle");
        return;
      }
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      setResult({
        blob,
        url,
        name: `recording_${timestampSlug()}`,
        mime,
        durationSec,
      });
    };
    try {
      rec.stop();
    } catch {
      setState("idle");
    }
  }, [stopMeter, stopTimer, activeMime]);

  const reset = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
    setResult(null);
    setElapsedSec(0);
    setState("idle");
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      // Full teardown on unmount — no leaked capture devices or rAF loops.
      cancelAnimationFrame(rafRef.current);
      window.clearInterval(timerRef.current);
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const ctx = meterCtxRef.current;
      if (ctx) void ctx.close();
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = null;
      }
    };
  }, []);

  return useMemo(
    () => ({
      state,
      permission,
      elapsedSec,
      level,
      error,
      devices,
      selectedDeviceId,
      selectDevice: (id: string) => setSelectedDeviceId(id),
      mime: activeMime,
      result,
      start,
      pause,
      resume,
      stop,
      reset,
    }),
    [state, permission, elapsedSec, level, error, devices, selectedDeviceId, result, start, pause, resume, stop, reset, activeMime]
  );
}

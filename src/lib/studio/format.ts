/** Formatting helpers — time, bytes, names. Pure functions. */

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const d = Math.floor((seconds * 10) % 10);
  return `${m}:${s.toString().padStart(2, "0")}.${d}`;
}

export function formatTimeMs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.000";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const carry = ms === 1000;
  const mm = carry ? (s === 59 ? m + 1 : m) : m;
  const ss = carry ? (s === 59 ? 0 : s + 1) : s;
  return `${mm}:${ss.toString().padStart(2, "0")}.${(carry ? 0 : ms).toString().padStart(3, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${Math.round(fraction * 100)}%`;
}

const PITCH_CLASSES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function pitchClassName(index: number): string {
  return PITCH_CLASSES[((index % 12) + 12) % 12];
}

export function timestampSlug(d = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

export function baseName(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

export function sanitizeFileName(name: string): string {
  // Keep unicode letters/numbers; replace path-hostile characters.
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "audio";
}

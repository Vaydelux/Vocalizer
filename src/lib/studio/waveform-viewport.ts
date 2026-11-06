/**
 * Lightweight waveform viewport planning.
 * A long recording may produce millions of timeline pixels when zoomed, but
 * the canvas bitmap must never scale with the entire recording duration.
 */
export const MAX_WAVEFORM_TIMELINE_PX = 4_000_000;
export const MAX_WAVEFORM_RASTER_PX = 8_192;

export interface WaveformViewport {
  /** Scrolling content width (CSS px). */
  timelineWidth: number;
  /** One visible canvas bitmap, never the whole timeline (CSS px). */
  viewportWidth: number;
  /** Effective time scale after the maximum timeline bound is applied. */
  pixelsPerSecond: number;
}

/** Zoom 0 means fit to current viewport. */
export function planWaveformViewport(
  durationSeconds: number,
  viewportWidthCss: number,
  zoomPixelsPerSecond: number,
): WaveformViewport {
  const width = Number.isFinite(viewportWidthCss)
    ? Math.max(1, Math.ceil(viewportWidthCss)) : 1;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { timelineWidth: width, viewportWidth: width, pixelsPerSecond: 1 };
  }
  const fitted = width / durationSeconds;
  const requested = Number.isFinite(zoomPixelsPerSecond) && zoomPixelsPerSecond > 0
    ? zoomPixelsPerSecond : fitted;
  const ideal = durationSeconds * requested;
  const timelineWidth = Math.max(width, Math.min(MAX_WAVEFORM_TIMELINE_PX, Math.ceil(ideal)));
  return {
    timelineWidth,
    viewportWidth: width,
    pixelsPerSecond: timelineWidth / durationSeconds,
  };
}

/** Convert a visible-canvas pointer x into an absolute scroll-timeline time. */
export function waveformTimeAtPointer(
  pointerX: number,
  scrollOffsetPixels: number,
  durationSeconds: number,
  layout: WaveformViewport,
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const x = Number.isFinite(pointerX) ? pointerX : 0;
  const scroll = Number.isFinite(scrollOffsetPixels) ? scrollOffsetPixels : 0;
  const time = (Math.max(0, scroll) + x) / layout.pixelsPerSecond;
  return Math.min(durationSeconds, Math.max(0, time));
}

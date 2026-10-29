"use client";

/** Triggers a browser download for a finalized output blob. */

export function downloadResult(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(text: string, name: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  downloadResult(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

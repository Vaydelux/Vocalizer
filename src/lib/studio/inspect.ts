/**
 * Local model-file import inspection — safe, real, and never executes anything.
 *
 * Flow: detect format → identify a plausible architecture (recognition only) →
 * compute a streaming SHA-256 via SubtleCrypto → associate nearby config files
 * → match registered adapters by format/architecture → report an honest
 * compatibility verdict. A "recognized" file is NOT executable; with no
 * runtime bundled the verdict is always "no compatible inference adapter".
 */

import { adaptersForFile, detectFormat, identifyArchitecture, isConfigFile } from "./registry";
import type { ModelArchitecture, ModelFormat, ModelInspectionResult } from "./types";

/** Stream a File to a SHA-256 hex string using SubtleCrypto. */
export async function hashFileSha256(file: File): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** Inspect a primary model file plus optional associated config files. */
export async function inspectModelFiles(
  primary: File,
  associated: File[] = []
): Promise<ModelInspectionResult> {
  const issues: string[] = [];
  const format: ModelFormat | null = detectFormat(primary.name);
  if (!format) {
    issues.push(
      `Unrecognized file extension: "${primary.name}". Recognized: .onnx, .pth, .pt, .ckpt, .safetensors.`
    );
  }
  const detectedArchitecture: ModelArchitecture | null = format ? identifyArchitecture(format) : null;
  const sha256 = await hashFileSha256(primary);
  if (!sha256) {
    issues.push("Could not compute SHA-256 (SubtleCrypto unavailable).");
  }

  const associatedConfigs = associated
    .filter((f) => isConfigFile(f.name))
    .map((f) => f.name);

  const compatibleAdapterIds = adaptersForFile(format);

  // Verdict: recognition ≠ execution. With no runtime, the honest verdict is
  // "recognized but no compatible adapter is currently available".
  let verdict: string;
  if (!format) {
    verdict = "File not recognized as a model weight. Nothing to import.";
  } else if (compatibleAdapterIds.length === 0) {
    verdict = "Model file recognized. No compatible inference adapter is currently available.";
  } else {
    verdict = `Model file recognized (${format}, plausible architecture: ${detectedArchitecture ?? "unknown"}). ${compatibleAdapterIds.length} adapter(s) declare this format, but none has a bundled runtime — inference stays unavailable. The file may be registered as metadata only.`;
  }

  return {
    ok: !!format,
    fileName: primary.name,
    format,
    detectedArchitecture,
    sizeBytes: primary.size,
    sha256,
    associatedConfigs,
    compatibleAdapterIds,
    verdict,
    issues,
  };
}

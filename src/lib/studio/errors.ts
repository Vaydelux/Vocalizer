/**
 * Typed, actionable error codes for Local Audio Studio.
 * Errors map to concise UI messages plus safe diagnostic detail for logs.
 */

export type StudioErrorCode =
  | "UNSUPPORTED_MEDIA"
  | "CORRUPT_FILE"
  | "MISSING_FILE"
  | "DECODE_FAILED"
  | "ENCODE_FAILED"
  | "CANCELLED"
  | "OUTPUT_EMPTY"
  | "INPUT_INVALID"
  | "MIC_PERMISSION_DENIED"
  | "RECORDING_DEVICE_LOST"
  | "INVALID_MODEL_MANIFEST"
  | "MODEL_UNAVAILABLE"
  | "CAPABILITY_UNAVAILABLE"
  | "FILE_TOO_LARGE"
  | "UNKNOWN";

export interface StudioError {
  code: StudioErrorCode;
  message: string;
  detail?: string;
}

const MESSAGES: Record<StudioErrorCode, string> = {
  UNSUPPORTED_MEDIA:
    "This file is not decodable by the current audio engine. The browser decoder rejected it.",
  CORRUPT_FILE: "The file appears to be corrupted — its audio data could not be read.",
  MISSING_FILE: "The referenced file is no longer available. Re-import it to continue.",
  DECODE_FAILED: "Audio decoding failed. The file may use an unsupported codec or be damaged.",
  ENCODE_FAILED: "Export encoding failed while writing the output file.",
  CANCELLED: "The operation was cancelled.",
  OUTPUT_EMPTY: "The operation produced an empty output. Nothing was saved as a result.",
  INPUT_INVALID: "The operation received invalid input. Check the selected files and options.",
  MIC_PERMISSION_DENIED: "Microphone access was denied. Grant permission and try again.",
  RECORDING_DEVICE_LOST: "The recording device was disconnected. Recording stopped.",
  INVALID_MODEL_MANIFEST: "The model manifest is invalid and was rejected.",
  MODEL_UNAVAILABLE:
    "The selected model is not installed or has no compatible runtime. Processing cannot start.",
  CAPABILITY_UNAVAILABLE:
    "This capability is not available in the current build or environment.",
  FILE_TOO_LARGE: "The file exceeds the size this web preview can process safely in memory.",
  UNKNOWN: "An unexpected error occurred.",
};

export class StudioErrorImpl extends Error implements StudioError {
  readonly code: StudioErrorCode;
  readonly detail?: string;

  constructor(code: StudioErrorCode, detail?: string, overrideMessage?: string) {
    super(overrideMessage ?? MESSAGES[code]);
    this.name = "StudioError";
    this.code = code;
    this.detail = detail;
  }
}

export function studioError(code: StudioErrorCode, detail?: string, overrideMessage?: string): StudioErrorImpl {
  return new StudioErrorImpl(code, detail, overrideMessage);
}

export function isAbort(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "AbortError" || err.name === "CanceledError")
  );
}

export function toStudioError(err: unknown): { code: StudioErrorCode; message: string; detail?: string } {
  if (isAbort(err)) {
    return { code: "CANCELLED", message: MESSAGES.CANCELLED };
  }
  if (err instanceof StudioErrorImpl) {
    return { code: err.code, message: err.message, detail: err.detail };
  }
  if (err instanceof Error) {
    return { code: "UNKNOWN", message: err.message || MESSAGES.UNKNOWN, detail: err.stack };
  }
  return { code: "UNKNOWN", message: MESSAGES.UNKNOWN, detail: String(err) };
}

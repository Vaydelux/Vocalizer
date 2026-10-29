/**
 * Typed errors for the Electron main process. Mirrors the renderer's error
 * codes so failures crossing IPC preserve their structured meaning.
 */

export type MainErrorCode =
  | "UNSUPPORTED_MEDIA"
  | "CORRUPT_FILE"
  | "MISSING_FILE"
  | "DECODE_FAILED"
  | "ENCODE_FAILED"
  | "CANCELLED"
  | "OUTPUT_EMPTY"
  | "INPUT_INVALID"
  | "CAPABILITY_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "DISK_FULL"
  | "UNKNOWN";

const MESSAGES: Record<MainErrorCode, string> = {
  UNSUPPORTED_MEDIA: "The file is not supported by the available decoders.",
  CORRUPT_FILE: "The file appears to be corrupted.",
  MISSING_FILE: "The referenced file does not exist.",
  DECODE_FAILED: "Audio decoding failed.",
  ENCODE_FAILED: "Audio encoding failed while writing the output.",
  CANCELLED: "The operation was cancelled.",
  OUTPUT_EMPTY: "The operation produced an empty output file.",
  INPUT_INVALID: "The request was invalid.",
  CAPABILITY_UNAVAILABLE: "A required capability or binary is unavailable.",
  PERMISSION_DENIED: "Permission was denied for a file operation.",
  DISK_FULL: "Insufficient disk space to complete the operation.",
  UNKNOWN: "An unexpected error occurred.",
};

export class MainError extends Error {
  readonly code: MainErrorCode;
  readonly detail?: string;
  constructor(code: MainErrorCode, detail?: string, override?: string) {
    super(override ?? MESSAGES[code]);
    this.name = "MainError";
    this.code = code;
    this.detail = detail;
  }
}

export function studioError(code: MainErrorCode, detail?: string, override?: string): MainError {
  return new MainError(code, detail, override);
}

/** Serialise an error for IPC (Error objects don't clone across contextIsolation). */
export function toMainErrorPayload(err: unknown): { code: MainErrorCode; message: string; detail?: string } {
  if (err instanceof MainError) {
    return { code: err.code, message: err.message, detail: err.detail };
  }
  if (err instanceof Error) {
    return { code: "UNKNOWN" as MainErrorCode, message: err.message, detail: err.stack };
  }
  return { code: "UNKNOWN" as MainErrorCode, message: MESSAGES.UNKNOWN, detail: String(err) };
}

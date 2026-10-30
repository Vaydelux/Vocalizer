/** Private, bounded staging for MediaRecorder bytes; no renderer-selected destination paths. */
import * as fs from "node:fs/promises";
import * as path from "node:path";

const MAX_BYTES = 64 * 1024 * 1024;
const JOB = /^[A-Za-z0-9_-]{1,80}$/;
const FORMATS = new Set(["webm", "ogg", "m4a"]);

export function recordingStagingDir(userData: string): string {
  return path.join(userData, "transient-recordings");
}

export async function stageRecordingBytes(
  userData: string, jobId: string, format: string, data: Uint8Array
): Promise<string> {
  if (!JOB.test(jobId) || !FORMATS.has(format)) throw new Error("Invalid recorded audio request.");
  if (!(data instanceof Uint8Array) || data.byteLength < 1 || data.byteLength > MAX_BYTES) {
    throw new Error("Recording must be 1 byte to 64 MiB. Save and re-import longer recordings.");
  }
  const h = data.subarray(0, 12);
  const valid = format === "webm"
    ? h.length >= 4 && [0x1a, 0x45, 0xdf, 0xa3].every((b, i) => h[i] === b)
    : format === "ogg"
      ? h.length >= 4 && String.fromCharCode(...h.subarray(0, 4)) === "OggS"
      : h.length >= 12 && String.fromCharCode(...h.subarray(4, 8)) === "ftyp";
  if (!valid) throw new Error("Recording container does not match its format.");
  const dir = recordingStagingDir(userData);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const output = path.join(dir, `mic-${jobId}.${format}`);
  const file = await fs.open(output, "wx", 0o600);
  try {
    await file.writeFile(data);
  } catch (error) {
    await file.close();
    await fs.rm(output, { force: true });
    throw error;
  }
  await file.close();
  return output;
}

export async function discardRecordingFile(file: string): Promise<void> {
  await fs.rm(file, { force: true });
}

/** Called once at application startup, before any jobs can be accepted. */
export async function cleanupOrphanedRecordings(userData: string): Promise<number> {
  const dir = recordingStagingDir(userData);
  let names: string[];
  try { names = await fs.readdir(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let deleted = 0;
  for (const name of names) {
    if (!/^mic-[A-Za-z0-9_-]{1,80}\.(webm|ogg|m4a)$/.test(name)) continue;
    const target = path.join(dir, name);
    const stat = await fs.lstat(target);
    if (!stat.isFile() && !stat.isSymbolicLink()) continue;
    await fs.unlink(target);
    deleted++;
  }
  return deleted;
}

/**
 * AI separation is run in an app-owned scratch folder. The worker must never
 * write into a user destination or delete pre-existing stems on cancellation.
 * Publish only a complete set of two or four validated outputs with no-overwrite semantics.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createStagedOutput, publishStagedOutput, cleanupStagedOutput } from "./export-file";

const JOB_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const VALID_EXT = new Set([".wav", ".mp3", ".flac"]);
const TWO_STEMS = new Set(["Vocals", "Instrumental"]);
const FOUR_STEMS = new Set(["Vocals", "Drums", "Bass", "Other"]);

export interface StemFile { stem: string; path: string }

export function inferenceScratchBase(userData: string): string {
  return path.join(userData, "inference-jobs");
}

export function publishInferenceStems(
  stems: StemFile[], scratch: string, destination: string, jobId: string
): StemFile[] {
  if (!JOB_ID.test(jobId)) throw new Error("Invalid inference job ID.");
  const received = new Set(stems.map(s => s.stem));
  const expected = stems.length === 2 ? TWO_STEMS : stems.length === 4 ? FOUR_STEMS : null;
  if (!expected || received.size !== expected.size ||
      [...expected].some(stem => !received.has(stem))) {
    throw new Error("Expected a complete, distinct two-stem or four-stem result.");
  }
  const scratchRoot = fs.realpathSync(scratch);
  const outputRoot = fs.realpathSync(destination);
  if (!fs.statSync(outputRoot).isDirectory()) throw new Error("Missing destination folder.");
  const inputs = stems.map(item => {
    const link = fs.lstatSync(item.path);
    if (!link.isFile() || link.isSymbolicLink() || link.size <= 0) {
      throw new Error("Model returned a missing, empty or linked file.");
    }
    const real = fs.realpathSync(item.path);
    const rel = path.relative(scratchRoot, real);
    if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      throw new Error("Model returned a file outside the isolated job folder.");
    }
    const ext = path.extname(real).toLowerCase();
    if (!VALID_EXT.has(ext)) throw new Error("Unsupported stem output format.");
    const dest = path.join(outputRoot, `Vocalizer-${jobId}-${item.stem.toLowerCase()}${ext}`);
    return { stem: item.stem, input: real, dest };
  });
  const stages: string[] = [];
  const published: { path: string; dev: number; ino: number; size: number }[] = [];
  try {
    // Stage ALL outputs before exposing any one to other applications.
    for (const item of inputs) {
      const stage = createStagedOutput(item.dest);
      stages.push(stage);
      fs.copyFileSync(item.input, stage, fs.constants.COPYFILE_EXCL);
      if (fs.statSync(stage).size !== fs.statSync(item.input).size) {
        throw new Error("Stem staging copy size mismatch.");
      }
    }
    for (let i = 0; i < inputs.length; i++) {
      publishStagedOutput(stages[i], inputs[i].dest);
      const stat = fs.statSync(inputs[i].dest);
      published.push({ path: inputs[i].dest, dev: stat.dev, ino: stat.ino, size: stat.size });
    }
    return inputs.map(({stem,dest}) => ({ stem, path: dest }));
  } catch (err) {
    // Roll back only our own published files, never any pre-existing file.
    for (const file of published) {
      try {
        const now = fs.lstatSync(file.path);
        if (now.isFile() && !now.isSymbolicLink() &&
            now.dev === file.dev && now.ino === file.ino && now.size === file.size) {
          fs.unlinkSync(file.path);
        }
      } catch { /* keep original failure */ }
    }
    throw err;
  } finally {
    for (const tmp of stages) cleanupStagedOutput(tmp);
  }
}

export function cleanupInferenceScratch(userData: string): number {
  const root = inferenceScratchBase(userData);
  if (!fs.existsSync(root)) return 0;
  let cleaned = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!/^job-[A-Za-z0-9_-]+$/.test(entry.name) || !entry.isDirectory()) continue;
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
    cleaned++;
  }
  return cleaned;
}

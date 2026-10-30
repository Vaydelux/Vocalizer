# Vocalizer — prerequisites, setup and your action checklist

**Last reviewed:** 2026-10-30 · **Package version:** 0.3.0 · **Target:** Windows x64

This is the user-side setup and release-readiness guide for [Vocalizer](https://github.com/Vaydelux/Vocalizer). See also [Windows acceptance](WINDOWS_ACCEPTANCE.md), [portable debug guide](DEBUG_PORTABLE.md), [initial release gates](INITIAL_RELEASE.md), and [inference worker](../inference/README.md).

> **Fast path:** You do **not** need Python, Node, Bun, CUDA, FFmpeg, PyInstaller or Visual Studio to run the already-built unpacked debug application. They are developer/build tools, not end-user installation requirements. The compatible AI model checkpoint is **not bundled**; you supply it separately to run real separation.

## 1. You only want to run Vocalizer (no installation)

- [ ] Use a **Windows x64** computer. Windows 10/11 is the practical testing target; a formal supported-OS minimum has not been certified. Leave several GB of free space for the archive, extracted application and output audio (10 GB+ is a **recommendation**, not a measured minimum).
- [ ] Open the [successful Phase 3 Windows build](https://github.com/Vaydelux/Vocalizer/actions/runs/41054501996), sign in to GitHub and download its dated artifact from **Artifacts**.
- [ ] Extract the GitHub artifact ZIP. It may contain a second ZIP named `Vocalizer-YYYY-MM-DD-Windows-x64-Debug.zip`; extract that too.
- [ ] Keep `Vocalizer.exe`, Electron DLLs and the **entire `resources/` folder together**. This is an unpacked application, **not** a standalone single-file EXE.
- [ ] Double-click `Run-Vocalizer-Debug.cmd` for DevTools + logs, or double-click `Vocalizer.exe` for normal startup.
- [ ] Test import, play/seek, Cutter, Joiner, Pitcher, Converter, cancellation and **Show output**. Report any failure with reproduction steps, Windows version, test format and DevTools/log evidence.

```powershell
# In the extracted application folder:
.\Vocalizer.exe --vocalizer-debug
```

Typical debug log: `%APPDATA%\Vocalizer\logs\debug.log` (actual location depends on Electron's userData path). An unsigned debug build may trigger SmartScreen. Run it only if you trust the exact GitHub Actions artifact; do not disable Windows security globally.

**Already bundled in the portable build:** Electron, compiled React/Next.js UI, FFmpeg, FFprobe and a frozen Python CPU worker. No system Python/Node/FFmpeg installation or admin privileges should be necessary just to open it. A clean-machine test is still required to confirm no hidden dependencies.

## 2. Extra prerequisite for AI separation

- [ ] Obtain a **lawfully acquired** local checkpoint named exactly `UVR-MDX-NET-Inst_HQ_5.onnx`. The model **is not included** in the release because redistribution permission is unverified. Vocalizer must not auto-download it when processing.
- [ ] Keep it at an absolute readable path such as `C:\Models\UVR-MDX-NET-Inst_HQ_5.onnx`.
- [ ] Confirm **59,074,342 bytes** and SHA-256 `811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000`.
- [ ] Import a short, legally usable WAV/MP3 sample and prepare a writable output folder.
- [ ] In **Vocal Remover**, select the track, choose the ONNX file and process two stems (`Vocals` and `Instrumental`) on CPU.
- [ ] Check that **two distinct real audio files** were written, play and seek each stem, select **Show in folder**, cancel/retry a separate job and repeat after restarting.
- [ ] Repeat the test with networking disabled. A worker handshake, filename selection or two file hashes alone is **not proof of correct musical separation**.

```powershell
Get-Item 'C:\Models\UVR-MDX-NET-Inst_HQ_5.onnx' | Select-Object Name, Length
(Get-FileHash 'C:\Models\UVR-MDX-NET-Inst_HQ_5.onnx' -Algorithm SHA256).Hash
```

Only this verified MDX-Net two-stem CPU path is in the current release acceptance scope. **Do not claim that packaged Demucs/RoFormer, CUDA or DirectML are verified.** 16 GB+ system RAM is a useful testing target, but not an established minimum.

## 3. Developer tools — optional if you're only testing the EXE

| Need | Tool / dependency |
| --- | --- |
| Clone and work with GitHub | Git |
| Next.js/Electron local source work | Node.js x64 supported LTS + Bun (CI pins **1.3.4**) |
| Electron and Python tests | PowerShell; Python **3.12 x64** for worker-specific tests |
| CPU worker dependencies | Python venv + `inference/requirements/cpu.txt` |
| Freeze a self-contained Windows worker | PyInstaller on a **Windows** environment |
| Package media tools | Windows x64 FFmpeg and FFprobe binaries |
| Reproducible Windows build | Windows GitHub Actions runner, which already provisions these tools |

CUDA, NVIDIA toolkit, developer API keys and cloud AI accounts are **not required** for the CPU preview. The required toolchain may change if a future dependency stops offering prebuilt wheels.

### Clone and validate source

```powershell
git clone https://github.com/Vaydelux/Vocalizer.git
cd Vocalizer
# Phase 3 is still a draft PR at the time of writing:
git checkout phase3/windows-acceptance-and-stem-playback

bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run typecheck:electron
python -m unittest discover -s tests -p "test_*.py" -v
bun run electron:build-renderer
bun run electron:compile
node scripts/test-safe-export.mjs
```

For development, run `bunx next dev -p 3000` in one PowerShell terminal and `bun run electron:dev` in another. The browser-only Next.js preview cannot access Electron's native worker or privileged FFmpeg IPC.

### Only if building the Python worker locally

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r inference/requirements/cpu.txt --extra-index-url https://download.pytorch.org/whl/cpu
python -m pip install pyinstaller pillow
```

For a full local Windows distribution, package the frozen worker into `inference-dist/windows-x64/` and provide `resources/binaries/ffmpeg.exe` plus `ffprobe.exe` before running `bun run dist:win:debug`. **The GitHub workflow already automates those prerequisites**. Do not cross-compile a Windows PyInstaller EXE on Linux and assume it is usable.

### Optional standalone real CPU inference verification

Python is a test driver here, not an end-user requirement. The current `scripts/verify-separation.py` invokes FFprobe from `PATH` despite accepting `--ffprobe-path`, so prepend the bundled directory:

```powershell
$env:PATH = "C:\Vocalizer-Debug\resources\binaries;$env:PATH"
python scripts/verify-separation.py `
  --input 'C:\Fixtures\song.wav' `
  --out 'C:\Fixtures\out' `
  --model-path 'C:\Models\UVR-MDX-NET-Inst_HQ_5.onnx' `
  --worker-exe 'C:\Vocalizer-Debug\resources\inference\inference-worker.exe'
```

Replace example paths with the real extracted directories.

## 4. GitHub Actions, release files and secrets

- [ ] Verify repository **Actions** are enabled, and check [source CI](https://github.com/Vaydelux/Vocalizer/actions/workflows/validate.yml).
- [ ] Check [Windows Debug EXE](https://github.com/Vaydelux/Vocalizer/actions/workflows/windows-preview.yml): it bundles the Windows worker, checks binaries, launches the packaged app, and runs a **synthetic FFmpeg trim/FFprobe smoke test**.
- [ ] Download and hash the dated debug ZIP, never a guessed EXE or executable from an unrelated site.
- [ ] For optional NSIS installer generation, select **`include_installer`** in the manual workflow run.
- [ ] Keep the **draft** prerelease unpublished until model and Windows acceptance gates pass. The draft can be staged with the workflow's draft-release option; a `main` push may also stage a draft.
- [ ] Never commit real `.env`, passwords, model weights, recordings, `node_modules`, `.venv`, signing certificates or locally generated release outputs.

```text
Vocalizer-YYYY-MM-DD-Windows-x64-Debug.zip
Vocalizer-YYYY-MM-DD-Windows-x64-Setup.exe      # optional
GitHub draft tag: debug-YYYY-MM-DD
```

**No random build numbers in public-facing file names.** Existing CI uses its built-in `GITHUB_TOKEN` for draft release operations. You do **not** need to share a personal access token or a code-signing certificate to test the debug ZIP.

## 5. Things you personally need to do before a public release

- [ ] **P0 — Windows hands-on acceptance:** On a real Windows computer, test the extracted app, navigation/themes, import, playback/seek, Cutter, Joiner, Pitcher, Converter, export and missing-file errors.
- [ ] **P0 — Real AI run:** Provide the exact checkpoint legally, verify its hash and test offline separation, in-app stems, cancellation, retry and recovery.
- [ ] **P0 — Legal model decision:** Obtain explicit permission to redistribute the checkpoint **or** choose another compatible model with proven distribution rights. Do not bundle uncertain weights.
- [ ] **P0 — FFmpeg compliance:** Audit the **exact distributed binary** and its license, copyright notices, source-code/source-offer obligations and bundled codec configuration.
- [ ] **P0 — Privacy/secrets:** Review previously tracked `.env`, local databases and their Git history; rotate any actually exposed credentials. Removing current files does not erase historical data.
- [ ] **P1 — Signing/policy:** Choose a public application license, third-party notices and whether to sign Windows release assets (recommended for public release, optional for private debug).
- [ ] **P1 — Fresh system check:** Verify the app on a Windows machine with no separately installed Python, Node or FFmpeg; measure CPU/RAM usage and startup/restart behavior.
- [ ] **P1 — Evidence:** Record OS edition, commit/run, media duration/format, result files/hashes, error logs and pass/fail outcomes without exposing private recordings.

## 6. Quick minimum functional checklist

- [ ] Starts without blank window, JavaScript crashes or missing packaged resources.
- [ ] Navigation, themes, keyboard, responsiveness and core panels work.
- [ ] WAV/MP3/FLAC import + metadata + play/pause/seek work.
- [ ] Real trimmed/joined/converted/pitched audio is nonempty and decodable.
- [ ] An existing output file is **never overwritten or deleted** on job failure or cancellation.
- [ ] Native **Show output** locates the correct file; deleting/moving it produces a controlled error.
- [ ] Cancelling FFmpeg stops the actual process and does not mark the job completed.
- [ ] Normal close, forced exit, and restart do not leave hung jobs.
- [ ] A valid model is accepted; an invalid model is rejected.
- [ ] Offline MDX CPU separation yields one playable Vocals and one playable Instrumental stem.
- [ ] Stem playback, seeking and folder reveal refer to the **correct source track**.
- [ ] Cancelling inference recovers; a subsequent job runs successfully.
- [ ] Debug logs are reviewed and scrubbed before public issue sharing.

## 7. What is **not** needed right now

- Cloud subscription, Supabase, API keys or remote AI account.
- CUDA/NVIDIA/GPU setup for the CPU-only preview.
- Windows installer, administrator rights, code signing, or Visual Studio simply to open the portable ZIP.
- Python/Node/Bun or system FFmpeg simply to run the unpacked build.
- Private credentials, private model files or personal test recordings in Git or chat.

## 8. Status and next steps

As of **2026-10-30**, source validation and [Phase 3 Windows debug build](https://github.com/Vaydelux/Vocalizer/actions/runs/41054501996) passed on commit `c57a8f1`. This includes a packaged startup test and original synthetic audio processing. **PR #3 remains draft**, real-model clean-Windows acceptance has not been completed, and the model-license gate remains open. Do not call this a fully bundled offline AI product or a production-approved public release.

**Next action for you:** Download the successful Windows debug ZIP, start `Run-Vocalizer-Debug.cmd`, complete Sections **1**, **2**, and **6**, and share any actual crash, UI or separation failures with sanitized logs. The development toolchain is optional.

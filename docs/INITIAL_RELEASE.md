# Vocalizer — initial Windows release plan

**Status: internal preview only. The current repository is not an approved public offline-AI release.**

## Scope and sequence

| Gate | Deliverable | Required evidence |
| --- | --- | --- |
| R0 — source integrity | Types, lint, Next.js export and Electron compile | GitHub Actions green on exact commit |
| R1 — worker | Windows x64 PyInstaller CPU worker | Packaged executable answers protocol init/shutdown |
| R2 — desktop | Windows x64 NSIS preview with FFmpeg/FFprobe and worker | Installer artifact and file inventory |
| R3 — integration | Packaged Electron launches and invokes the worker | Windows GUI/integration test, real audio stem decoding |
| R4 — model licensing | Default model legally redistributable | Exact license/permission, SHA-256 and notices |
| R5 — offline acceptance | Fresh installed machine separates a real song with network disconnected | Logs, decoded stems, repeat after restart |
| R6 — first public release | Signed or documented unsigned pre-release, versioned and documented | All prior gates pass, smoke tests and release notes |

## Current blockers

- The desktop build is a Next.js static export. Remove server-only API endpoints rather than shipping routes that depend on a Node.js server.

- The trained `UVR-MDX-NET-Inst_HQ_5.onnx` model is **not** bundled. Public availability does not establish redistribution rights.
- Windows packaging and installed-app playback/inference have not been run in this conversation.
- The existing worker uses `audio-separator`'s model catalog and may fetch weights unless explicitly pre-staged; do not claim the preview is offline-AI-ready.
- The model loader currently receives `modelPath` but resolves `modelId`; validate strict local-only model resolution before R5.
- Review desktop IPC paths and file overwrite protections before publishing R6.
- The repository had a tracked local `.env` file and `db/custom.db`; audit the history/data before public release. Removing a file now does not remove it from Git history.
- Code signing, provenance notices, and Windows GUI/microphone tests remain open.

## Building

For local web development:

```powershell
bun install --frozen-lockfile
bun run dev
```

For the Electron renderer and type checks:

```powershell
bun run lint
bun run typecheck
bun run typecheck:electron
bun run electron:build-renderer
bun run electron:compile
```

For a Windows preview, run the **Windows Preview** GitHub Actions workflow manually. It builds a CPU worker, bundles FFmpeg and generates an unsigned NSIS installer as an Actions artifact. This is **not** a release publication and **does not include AI model weights**. A job failure is a release blocker; do not bypass it with continue-on-error.

## Release policy

- No automatic tag or GitHub Release publication from a pull request or an unverified workflow run.
- Never ship a supposedly offline AI installer without an approved bundled checkpoint and an observed, successful offline inference test on the installed app.
- Never include developer environment files, private database records, tokens, private keys, test recordings or downloaded model caches in installation artifacts.
- Record exact model hash, runtime versions, test machine specs, execution commands, benchmark results and installer hash for the first release.

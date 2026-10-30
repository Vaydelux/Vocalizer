# Vocalizer — initial Windows release plan

Read [Quick Help](QUICK_HELP.md) for setup, feature-by-feature instructions and tooltip descriptions.

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
- Packaged Windows x64 startup and synthetic native FFmpeg trim/microphone-mix smoke tests have passed on previous CI commits. Full real-device GUI, microphone and model-backed inference are still unverified on clean Windows hardware.
- The approved CPU MDX path rejects missing or checksum-mismatched local checkpoints before loading. No model is bundled; the installed-app real-model Windows acceptance remains open.
- Both Electron main and Python verify the exact local MDX model file; arbitrary registered models and Demucs/RoFormer inference are not yet enabled.
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

For a Windows preview, run the **Windows Debug EXE** GitHub Actions workflow. It bundles the CPU worker and FFmpeg/FFprobe into an **unsigned portable ZIP** by default. An optional unsigned NSIS setup is generated only when requested. This is **not** a release publication and **does not include AI model weights**. A job failure is a release blocker; do not bypass it with continue-on-error.

## Release policy

- No public production release from PRs. Successful main Windows builds may stage/update a **draft** GitHub prerelease; drafts must not be publicly published without acceptance.
- Never ship a supposedly offline AI installer without an approved bundled checkpoint and an observed, successful offline inference test on the installed app.
- Never include developer environment files, private database records, tokens, private keys, test recordings or downloaded model caches in installation artifacts.
- Record exact model hash, runtime versions, test machine specs, execution commands, benchmark results and installer hash for the first release.

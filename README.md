# Vocalizer

Vocalizer is a Windows-first local audio studio built with Next.js/React and Electron, with FFmpeg-powered editing and a Python AI separation worker.

**Release status:** The application is under development. CI builds use static export (no server-only API routes). A standalone MDX-Net CPU path has been reported working on Linux and Windows preview packaging has passed CI. The RoFormer safetensors CPU compatibility preview accepts local checkpoint/config pairs; real user-model compatibility and clean-machine acceptance are not yet verified. The current model's redistribution permission remains unresolved.

## Get started

```bash
bun install --frozen-lockfile
bun run dev
```

`bun run typecheck`, `bun run typecheck:electron`, and `bun run lint` are available source checks. Use `bun run electron:build-renderer` and `bun run electron:compile` before packaging.

See [Initial release plan](docs/INITIAL_RELEASE.md) for required Windows packaging, model licensing, security and offline-testing gates. See [Inference worker](inference/README.md) for the CPU inference setup and limitations.

**Do not ship model files or credentials without reviewing their permissions and provenance.**

For the local-only experimental HTDemucs v4 four-stem workflow, see [HTDemucs checkpoint and acceptance guide](docs/DEMUCS_V4_OFFLINE.md). Model weights are not included in the application.

Project recovery: [Version 2 project format and manual media relinking](docs/PROJECT_V2_RECOVERY.md).

Local safetensors checkpoints: [BS-RoFormer / Mel-Band RoFormer guide](docs/ROFORMER_LOCAL_MODELS.md).

# Vocalizer

Vocalizer is a Windows-first local audio studio built with Next.js/React and Electron, with FFmpeg-powered editing and a Python AI separation worker.

**Release status:** The application is under development. A standalone MDX-Net CPU inference path has been reported working on Linux, but the Windows installer and bundled offline model are not yet verified. The current model's redistribution permission remains unresolved.

## Get started

```bash
bun install --frozen-lockfile
bun run dev
```

`bun run typecheck`, `bun run typecheck:electron`, and `bun run lint` are available source checks. Use `bun run electron:build-renderer` and `bun run electron:compile` before packaging.

See [Initial release plan](docs/INITIAL_RELEASE.md) for required Windows packaging, model licensing, security and offline-testing gates. See [Inference worker](inference/README.md) for the CPU inference setup and limitations.

**Do not ship model files or credentials without reviewing their permissions and provenance.**

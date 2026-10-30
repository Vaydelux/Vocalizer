# Vocalizer Windows debug EXE (no installer)

This build is a **portable-folder / unpacked Electron application**. It does not install anything, write an uninstall entry, or require administrative permissions. It is **not** a single self-contained executable: keep the entire extracted folder, especially `resources/`, next to `Vocalizer.exe`.

## Download the GitHub Actions artifact

1. Open [Windows Debug EXE](https://github.com/Vaydelux/Vocalizer/actions/workflows/windows-preview.yml).
2. Select a successful run on `phase2/windows-inference-integration`.
3. Download the **Vocalizer-0.3.0-windows-x64-debug** artifact.
4. Extract its entire ZIP to an ordinary writable folder on Windows x64.
5. Double-click **Run-Vocalizer-Debug.cmd** to launch with DevTools and a diagnostic log, or **Vocalizer.exe** for ordinary operation.

With `--vocalizer-debug`, the Electron app opens Developer Tools and writes startup/load/crash events to `logs/debug.log` under its actual Electron `userData` folder (often `%APPDATA%\Vocalizer\logs\debug.log`).

You can also run from PowerShell:

```powershell
.\Vocalizer.exe --vocalizer-debug
```

## Build locally on Windows

The build requires the JavaScript dependencies, the separately packaged PyInstaller CPU worker at `inference-dist/windows-x64`, and FFmpeg/FFprobe executables under `resources/binaries`. The GitHub Actions workflow prepares those prerequisites automatically.

```powershell
bun install --frozen-lockfile
bun run dist:win:debug
.\release\win-unpacked\Vocalizer.exe --vocalizer-debug
```

The script uses `electron-builder --dir --publish never`: no NSIS installer, no GitHub release and no publishing token required. The workflow checks that the EXE, worker, app archive, and FFmpeg executables are present before uploading the whole directory. The downloaded artifact is itself a ZIP.

## Limitations

- Unsigned debug build. Windows SmartScreen may warn; only run a binary from your trusted CI build.
- No bundled default AI weights: the MDX-Net checkpoint redistribution rights are still unverified. The Remover can accept a compatible, locally supplied, SHA-256-verified checkpoint.
- Builds and worker handshakes are **not the same as installed application / GUI / audio inference verification**. Test launch, file import, playback, non-AI tools, and CPU separation manually. Attach the log and relevant Actions run URL when reporting a failure.
- GitHub Actions artifact retention is limited; this is not a public release.

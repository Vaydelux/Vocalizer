# Vocalizer — Windows packaged app acceptance

**Scope:** Windows x64 unpacked debug application, local audio processing and
optional local MDX-Net CPU inference. This is an acceptance procedure, not a claim
that the app has passed on a clean Windows computer.

## Automated gate (GitHub Actions)

The Windows build runs:

```powershell
Vocalizer.exe --vocalizer-smoke-test
```

The process must exit with code 0 within 90 seconds after verifying:
- Packaged Electron renderer displays actual application content.
- The sandboxed preload exposes `window.studio.isNative === true`.
- Native IPC reports that bundled FFmpeg and the frozen worker are present.

A passing startup probe **does not** verify real audio playback, inference,
correct model weights, microphone devices or Windows media permissions.

## Manual clean-machine acceptance

Extract **all** contents of the dated debug ZIP to a writable folder. Do not
move `Vocalizer.exe` away from `resources/`. Ensure there is no installed
Python, Node.js or FFmpeg dependency being silently used from the system PATH.

1. Launch `Run-Vocalizer-Debug.cmd`; confirm the full UI appears, no blank
   panels, the sidebar navigates, and DevTools displays no crash-level errors.
2. Import a locally stored WAV, MP3 and (if available) FLAC file. Verify the
   filename, duration, sample rate and playback. Remove/reimport a track to
   verify stale object URLs and waveform state are not reused.
3. Use Cutter to produce a short WAV. Verify the output is decodable and
   nonempty, then use **Processing Queue → Show output** and confirm Windows
   Explorer highlights the real output. Try moving/deleting the file and
   confirm the UI produces a controlled missing-file error, not a crash.
4. Exercise Joiner, Pitcher and Converter with ordinary sample tracks. Check
   saved file paths, duration, channels and output formats. Verify cancellation
   leaves no incorrectly reported completed output.
5. Close Vocalizer while idle; reopen and repeat steps 1–3.
6. Close and restart during a long running job; verify the UI starts without
   orphaned subprocesses or a permanently stuck queue.
7. For AI verification, obtain a **lawfully acquired** exact
   `UVR-MDX-NET-Inst_HQ_5.onnx` checkpoint. Confirm its SHA-256 equals
   `811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000`.
   The model is not bundled pending redistribution permission.
8. On Remover, import the original track, select the local model, choose an
   output directory, and run CPU separation while disconnected from the
   network. Expect one Vocals and one Instrumental file. Play each with the
   **in-app** audio preview, seek within it, and check **Show in folder**.
9. Repeat the inference with a different source track and folder. Confirm no
   previous stems appear as if they belonged to the new source.
10. Run cancellation during inference, verify the cancelled status, no fabricated
    completed output, worker cleanup, and ability to perform a new job.
11. Capture CPU time/memory and output durations on a representative real music
    fixture. Do not infer separation quality merely from nonidentical file hashes.

## Standalone Windows CPU inference verification (optional)

From the repository checkout and the complete unpacked debug folder, with
`ffprobe.exe` accessible, run:

```powershell
python scripts/verify-separation.py --input "C:\\fixtures\\song.wav" --out "C:\\fixtures\\out" `
  --model-path "C:\\models\\UVR-MDX-NET-Inst_HQ_5.onnx" `
  --worker-exe "C:\\Vocalizer\\resources\\inference\\inference-worker.exe" `
  --ffprobe-path "C:\\Vocalizer\\resources\\binaries\\ffprobe.exe"
```

The verifier checks both output streams with FFprobe, duration/stream validity,
unique correct stem labels, distinct real file paths and nonidentical file bytes.
It does **not** provide SDR or SI-SDR accuracy scores.

## Diagnostics and bug reports

Run `Vocalizer.exe --vocalizer-debug` or the bundled CMD launcher. Gather
`debug.log` from the Electron `userData/logs` directory, the Console errors
from DevTools and a concise reproduction procedure. Record the exact GitHub
Actions run URL, Windows build, test media format and whether the app was
connected to the network. Do not upload private recordings or authentication
tokens to a public issue.

## Release gate

Do not label this as a public production or fully offline-AI release until
the model redistribution review and the real Windows acceptance items have
passed. Source CI, an EXE artifact, and a successful startup probe are necessary
but not sufficient.

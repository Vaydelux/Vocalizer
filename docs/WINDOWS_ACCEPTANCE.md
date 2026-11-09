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
- Main registers a short, synthetic WAV only in the packaged smoke-test
  process; it cannot be registered by the renderer or by normal app sessions.
- Chromium requests an actual `las://renderer/__stem-audio/` byte range from
  the completed-stem registry and verifies `206`, `Content-Range`, returned
  byte count, and content length.
- A real Chromium HTMLAudioElement loads metadata and seeks to 1.0 seconds
  through that same media route, without requiring autoplay.
- The request for an unregistered stem is still rejected by native IPC.

A passing startup probe **does not** establish audible output, real-song codec
seeking, inference fidelity, correct model weights, microphone devices, or
Windows media permissions. It only proves metadata, byte-range transport and
seeking on a short synthetic PCM WAV inside packaged Chromium.

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

## Audio preview volume/mute regression

For a locally playable WAV or MP3, verify all of these interactions in Cutter:

1. Set volume to 60%, mute, then raise the slider to 80%. The media must
   become audible again; both the icon and underlying player should unmute.
2. Set volume to zero, then click the mute control to unmute. Vocalizer
   restores the last audible volume rather than staying silently at zero.
3. Rapidly toggle mute twice. The slider should retain its previous volume,
   and the audio element should end in its original unmuted state.
4. Switch tracks after muting, then raise the volume. The new audio element
   must use the same visible volume/mute state, not stale volume settings.

Source CI includes deterministic volume-state tests. Actual audible output,
Windows audio routing and hardware mixer behavior still require manual QA.

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

## Browser/renderer export safety

Run the source unit tests for WAV size/layout preflight and MP3 multichannel
downmix as part of the PR validation suite. The in-memory browser WAV encoder
rejects payloads exceeding 128 MiB, invalid layouts and empty output **before**
allocating encoded memory; larger desktop exports should use native FFmpeg
streaming rather than silently wrapping RIFF chunk lengths.

For manual playback QA, inspect a short mono, stereo and 3+-channel sample
after MP3 export. Additional channels are **averaged** into the secondary
channel; this prevents 16-bit overflow but does not reproduce a standard
surround-speaker matrix. Verify there is no crackling caused by integer
wraparound and compare levels against the original source.

A green source test proves header sizes and PCM arithmetic, not perceptual
quality, codec compatibility or stability on low-memory Windows systems.

## Cancelled browser export and output URL cleanup

Source regression coverage includes a race where the user cancels while an
encoder is about to return its final Blob. The job must remain **cancelled**,
must not advertise a completed result, and must release the newly created
browser `blob:` URL instead of retaining the audio bytes in renderer memory.
Invalid/empty byte counts are rejected before a job is marked completed.

On a physical Windows debug build, repeat short export / cancel cycles with
DevTools memory monitoring. Confirm that canceled results do not appear as
completed in the queue and that memory returns toward baseline after garbage
collection. Native disk-backed output paths are not removed by browser URL
cleanup; native FFmpeg owns staging and cancellation separately.

Synthetic unit tests prove lifecycle logic, not stable long-session memory
usage, user-visible audio playback, or Windows filesystem behavior.

## Native Joiner and crossfade quality

Join at least two clips in each configuration:

1. Two equal-length WAV clips, 0-second crossfade: output duration is the sum
   and there is no missing tail or unexpected overlap.
2. Two clips with a 0.5-second crossfade: verify both sources actually
   overlap near the boundary, rather than starting the second clip late.
3. Three clips with a short middle item: overlap is capped to half of either
   adjacent clip, so fade-in and fade-out of the middle clip cannot intersect.
4. Join 44.1 kHz mono WAV with 48 kHz stereo MP3/FLAC in Windows: the
   exported stream must use the selected sample rate and channel count.
5. Listen near transitions and compare the output duration to the Joiner
   estimate. Equal-power fades may increase peaks for highly correlated
   sources, so inspect peak levels for clipping.

The automated timeline and FFmpeg argument tests cover scheduling and
validation. A Windows FFmpeg smoke run verifies actual mixed-rate encoding;
perceptual listening and device compatibility remain physical QA requirements.

## Native FFmpeg MP3 bitrate verification

The desktop audio editor must send the per-job selected MP3 bitrate (128, 192,
256, or 320 kbps) through renderer IPC to FFmpeg for Trim (re-encode), Join,
Pitch, Convert, Karaoke Mix, and Multitrack Mixdown. If no per-job setting is
provided, use the saved preference. The native IPC schema rejects unsupported
rates; older direct IPC requests without the field retain a 192 kbps fallback.

Windows CI creates original synthetic audio and runs the actual FFmpeg export
with 128 and 320 kbps settings. FFprobe verifies MP3 codec, nonzero duration,
and encoded stream bitrate. Source tests verify every editor operation's
arguments, all four supported bitrates, and fallback behavior.

For physical Windows acceptance, encode the same source at 128 and 320 kbps
using the app's export selector, inspect both outputs in an audio metadata tool,
and listen for encoder clipping or channel issues. **Lossless Stream-Copy**
preserves the source bitstream; a selected MP3 bitrate cannot change the
bitrate without transcoding. Disable stream-copy to apply MP3 encoding settings.

These checks cover editor FFmpeg exports, not model-worker-generated stems,
which follow a separate inference/export protocol.

## Native Cutter: verified lossless stream-copy containers

Cutter's **Lossless Stream-Copy** is available only in Electron. In a web
preview it must be disabled and a direct web task must reject lossless mode,
rather than silently decoding and re-encoding.

The desktop worker probes the actual audio codec and container before showing
the save dialog. It selects the matching verified extension instead of using
the separate MP3/WAV export preference. Supported copy-safe pairs include
MP3; PCM WAV; AAC/ALAC M4A; ADTS AAC; Ogg Vorbis/Opus; WebM Opus/Vorbis;
PCM AIFF; and WMA. Unknown, mismatched or incompatible codec/container pairs
must fail with an actionable re-encode suggestion.
FLAC copy-cuts are deliberately unsupported: FFmpeg may preserve the original
STREAMINFO total-samples value, causing a shortened FLAC to report the full
input duration. For a precision cut of a FLAC source, disable stream-copy and
export 24-bit PCM WAV (lossless decoding/re-encoding). A renamed file is not proof
of its codec or container.

Native main repeats the FFprobe check before opening a staged file, rejects a
mismatched output extension or any stream-copy + loudness-normalize request,
and verifies the resulting codec remains identical to the input before
publishing. Cancellation during preflight must prevent the FFmpeg process
from launching. Never overwrite an existing user output file.

Windows CI generates original test tones and verifies real MP3/WAV/FLAC/M4A/
Ogg stream-copy trims, FFprobe codec identity, sensible duration and staged
publication. It also tests extension-spoofing rejection.

Physical-device QA: try MP3, WAV, FLAC, AAC/M4A and Ogg as well as one
unsupported codec. Check the file extension, playback, metadata, small-region
cut timing, input immutability, cancellation, and a destination that already
exists. Audio stream-copy preserves codec frames but is **not guaranteed
sample-accurate** around compressed packet/frame boundaries. Use re-encoding
for precise positioning or DSP effects such as loudness normalization.

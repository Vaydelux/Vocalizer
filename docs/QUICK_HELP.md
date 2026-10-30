# Vocalizer Quick Help — Windows Debug Preview

> This guide describes the currently implemented app, not future designs. It is
> also available **inside Vocalizer → Quick Help** with searchable,
> tooltip-by-tooltip explanations. Click **Help** in any workspace's title bar,
> or hover/focus the desktop sidebar navigation for a short description.

## 1. Before starting — downloads

1. **Windows x64 portable ZIP:** Open [Windows Debug EXE Actions](https://github.com/Vaydelux/Vocalizer/actions/workflows/windows-preview.yml) and choose the **latest successful `main` run for the commit you intend to test**. Download the dated `Vocalizer-YYYY-MM-DD-Windows-x64-Debug` artifact. Extract the artifact ZIP and then any nested ZIP. Keep the **whole** application folder together.
2. **Run:** Double-click `Vocalizer.exe`, or `Run-Vocalizer-Debug.cmd` for diagnostic DevTools. No Node.js, Python, FFmpeg, CUDA, Supabase, web login, or system installer is required to open the packaged preview; Electron, FFmpeg, FFprobe and the frozen CPU worker are included.
3. **Optional two-stem AI model:** Obtain your own lawful copy of `UVR-MDX-NET-Inst_HQ_5.onnx`; weights are **not** shipped with the app while redistribution rights are unresolved. The [model provenance record](../inference/models/PROVENANCE.md) contains the source URL, filename, exact size and SHA-256. Verify the file with PowerShell before selecting it.
4. **Disk and memory:** Allow space for the roughly 1 GB debug archive, extracted runtime, model, and temporary/output media; **10 GB free** and **16 GB RAM** are cautious test targets, not measured official minimums. Start with a short clip, and select Lower memory if needed.

```powershell
Get-Item 'C:\Models\UVR-MDX-NET-Inst_HQ_5.onnx' | Select-Object Name,Length
(Get-FileHash 'C:\Models\UVR-MDX-NET-Inst_HQ_5.onnx' -Algorithm SHA256).Hash
# Expected: 811cb24095d865763752310848b7ec86aeede0626cb05749ab35350e46897000
# Exact size: 59074342 bytes
```

Do not disable Windows security globally to run an unsigned debug build. Run
only code/artifacts you trust from the repository's successful CI.

## 2. Five-minute first use

1. **Home → Import:** Choose a short WAV or MP3 you may legally edit. Verify **Ready**.
2. **Home → Track actions (···) → Open in Cutter:** Drag a region or edit Start/End.
3. **Cutter → Export selection:** Select format and save to a **new** file.
4. **Processing Queue:** Wait for Completed and choose **Show output** / Save.
5. **Play the actual saved file:** Confirm duration, audio quality and path.
6. **Optional:** Try Joiner, Pitcher, Recorder and AI Remover as below. Save every result before closing—imported library state is session-only.

## 3. Workspace-by-workspace guide

| Workspace | Controls / tooltip descriptions | How to use |
| --- | --- | --- |
| **Home** | Import = local session files; Search = session filter; Ready/Error = decode status; ··· = open tool/retry/remove; Remove only removes library entry | Import → confirm Ready → use ··· to open a track |
| **Cutter** | Waveform = select region; Start/End = exact boundaries; I/O = selection edges; L = loop; Split midpoint = edit selection; Undo/Redo = selection history; Export = new saved file | Select track → drag region → preview → choose format → Export |
| **Joiner** | Add track = append; Up/Down = order; Remove = remove from join only; Preview = listen; Crossfade = overlap edges; Channels = mono/stereo; Sample rate follows Settings; Join = export new mix | Add 2+ tracks → reorder → set crossfade → export |
| **Pitcher** | Pitch = semitone change; Fine cents = precision; Tempo = speed/stretch; Preserve duration = granular time/pitch mode; Render Preview = actual processing; Original/Processed = A/B; Reset = restore settings | Select → pitch/tempo → preview both → Export |
| **Key & BPM Finder** | Analyze BPM = tempo estimate; Analyze Key = chroma estimate; Half/double tempo = ambiguity; Manual corrections = explicit user overrides; Copy/Export = metadata | Analyze → listen/verify → optionally correct → copy |
| **Recorder** | Input device = mic selection; Start = permission prompt; Meter = approximate levels; Pause/Resume; Stop = final take; Save original = captured container; Export WAV/MP3 = conversion job | Select mic → record → stop → preview → save |
| **Karaoke** | Instrumental = backing track; Import LRC = timestamped lyrics; Offset = lyric timing; Start/Stop = microphone; Save take = raw recording; Mix format = combined output; Export mix = native FFmpeg | Import backing track → optional LRC → record → save take → export mix |
| **Remover** | Check runtime = worker presence, not model readiness; Choose model = exact verified local ONNX; Lower memory = 128 segments; Balanced = baseline 256; Thorough = overlap 0.50, not guaranteed better; Start = real CPU separation; Preview = stem player; Show folder = Explorer | Import → choose model → select profile/output folder → Start → listen to both stems |
| **Splitter** | Stem layout / result slots = metadata/placeholders ONLY | **Not operational:** four/six-stem inference is not shipped. |
| **Model Manager** | Inspect = metadata/hash; Associated config = optional metadata; Register = metadata only; Validate manifest = schema only; Catalog Download = disabled; Preferred = future registry resolution | Use Remover for real MDX execution; do not confuse registration with installation |
| **Processing Queue** | Queued/Running = job state; Indeterminate = no numeric progress; Cancel = request stop; Completed = output; Logs = error history; Clear = UI history; Previous sessions = receipts only | Check progress → save output → inspect logs if failed |
| **Settings** | Theme/Accent = appearance; Volume = playback; WAV16/24 = PCM; MP3 bitrate = file size/quality tradeoff; Sample rate = resample; Concurrency = resource usage; Model fallback policy = currently inactive | Pick preferred appearance/output defaults |
| **System Information** | Refresh = recheck; Audio/Codec = detection only; CPU/GPU = system information, not AI device guarantee; Copy = diagnostics | Check detected capabilities; review copied report before sharing |
| **Quick Help** | Search = filter topics/controls; Expand = each button explained; Open workspace = navigate without changing audio; Page Help = open current section | Press Help anywhere or choose Quick Help from sidebar |

## 4. What the buttons cannot guarantee

- **AI:** The included CPU worker and two-stem MDX inference require a user-provided checksum-verified checkpoint. Model Manager registrations do not turn other models into executable backends. **Demucs and RoFormer are not installed engines**.
- **Quality profiles:** Lower memory, Balanced and Thorough only tune MDX inference parameters; they do not automatically improve SI-SDR or deliver studio-quality audio.
- **Offline benchmarking:** `scripts/benchmark-separation.py` can measure reference-based SI-SDR if you provide **genuine clean reference stems**. Without ground truth, reconstruction SNR cannot establish separation quality.
- **Sessions:** Imported tracks, editing history and incomplete jobs do not form a persistent project. Previous-session job receipts are **read-only**, not a resume function.
- **Files:** No output should overwrite a pre-existing file; check exported audio yourself, and keep the saved file outside the app's temporary directories.

## 5. Accessibility and shortcuts

- Navigate with Tab / Shift+Tab and activate buttons with Enter or Space.
- Desktop primary shortcuts: **Alt+1 Home, Alt+2 Cutter, Alt+3 Joiner, Alt+4 Pitcher, Alt+5 Remover, Alt+6 Queue** (unless typing in an input).
- Hover or keyboard-focus the sidebar items for tooltips. The **Help** button in each page header opens a longer, searchable description so touch and screen-reader users do not rely on hover.
- Where possible, use native audio controls to play, pause and seek stems.

## 6. Problem-solving

| Symptom | First action |
| --- | --- |
| App starts blank | Run `Run-Vocalizer-Debug.cmd`; inspect `debug.log` and DevTools; ensure `resources/` was extracted beside `Vocalizer.exe` |
| Import fails | Start with WAV/MP3, verify the file is accessible and not empty; use Retry; try a shorter test |
| No microphone | Enable app microphone access in Windows Privacy settings; reconnect/select the device; check Recorder error |
| Job stuck or failed | Open Queue → job logs; retry with a short audio source and new writable destination |
| Can't separate vocals | Check CPU worker status in Remover, exact model filename/size/hash, output permissions and free RAM |
| AI is very slow | Start with a short clip and Lower memory; compare CPU, RAM and output; model processing time is hardware dependent |
| Splitter / arbitrary model unusable | Expected for this preview; not yet an implemented inference workflow |
| Work gone after restart | Imports are session-only. Re-import original files; recover saved outputs separately. Job receipts are status history only |

## 7. Release acceptance — do not skip

See [Windows acceptance checklist](WINDOWS_ACCEPTANCE.md). This app is suitable
for **controlled alpha/debug evaluation** once a successful Windows build is
downloaded; this is **not a guarantee of zero bugs**. Public production
readiness still requires actual Windows GUI/microphone playback validation,
checkpoint-backed offline inference, forced-exit/recovery tests, accessibility,
legal/FFmpeg redistribution review and release signing decisions.

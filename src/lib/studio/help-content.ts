import type { ViewId } from "./store-ui";

/** Single source of truth for the in-app guide, contextual help and sidebar tooltips.
 * Keep capability claims tied to shipped functionality. */
export type HelpEntry = {
  id: ViewId;
  title: string;
  summary: string;
  availability: "Ready for desktop testing" | "Requires a user-provided AI model" | "Not implemented" | "Metadata only";
  steps: string[];
  controls: { label: string; description: string }[];
  caution?: string;
};

export const HELP_ENTRIES: HelpEntry[] = [
  {
    id: "home", title: "Home · Audio Library", availability: "Ready for desktop testing",
    summary: "Import, inspect, search, and route local recordings to editing tools. Imports are session-only.",
    steps: ["Drop audio onto the import area or use its file chooser.", "Allow the app to inspect the audio and confirm its status is Ready.", "Use the track actions menu to open Cutter, Joiner, Pitcher, Key & BPM, or Karaoke.", "Save exports to a folder before closing; importing does not save a project."],
    controls: [
      {label:"Import / drop area",description:"Adds your local files to this session. WAV, MP3 and FLAC are practical starter test formats. It does not upload to a server."},
      {label:"Search library",description:"Filters already-imported tracks by name, status or metadata; it does not search your Windows drive."},
      {label:"Status: Ready / Error",description:"Ready means import validation completed. Error means the file could not be inspected; open the error details and retry when appropriate."},
      {label:"Track actions (···)",description:"Choose an editor for that specific track, retry a failed import or remove the entry from this session."},
      {label:"Retry import",description:"Attempts to inspect the same file again. If the original file was moved, import it again from its new location."},
      {label:"Remove",description:"Removes the entry from the session library, not the original audio file on disk."},
    ], caution:"The library is not a persistent project manager. Closing Vocalizer loses imported track references."
  },
  {
    id:"cutter",title:"Cutter",availability:"Ready for desktop testing",summary:"Select a portion of a track and save it as new audio without changing the original.",
    steps:["Choose an imported track.","Drag across the waveform to make a selection, or set its Start and End fields.","Preview your region; use I and O for selection edges and L for loop where supported.","Choose WAV/MP3 settings and select Export selection.","Check Processing Queue, then listen to the resulting file."],
    controls:[
      {label:"Track selector",description:"Chooses which imported audio file the timeline displays."},
      {label:"Waveform selection",description:"Drag to set the region. Seeking changes playback position without changing the original audio."},
      {label:"Start / End (mm:ss.mmm)",description:"Precisely edit the left and right selection boundaries; End must be later than Start."},
      {label:"Export selection",description:"Queues a new trimmed file. You must choose and verify an output destination."},
      {label:"Split at midpoint",description:"Divides the current selection at its center for editing; this does not overwrite the source."},
      {label:"Undo / Redo",description:"Reverses or reapplies recent selection edits during this editing session."},
      {label:"Export format / bitrate",description:"WAV is uncompressed PCM; MP3 is compressed. Higher MP3 bitrate generally uses more space."},
    ]
  },
  {
    id:"joiner",title:"Joiner",availability:"Ready for desktop testing",summary:"Combine two or more imported tracks into an ordered output.",
    steps:["Import at least two tracks in Home.","Add tracks to Join list in the intended order.","Use the move-up/down buttons; preview tracks before committing.","Set crossfade, channels and output format.","Select Join / Export, then verify the generated audio."],
    controls:[
      {label:"Add track",description:"Appends an imported audio source to the join list. Duplicate entries may be disallowed."},
      {label:"Move up / down",description:"Reorders source clips; playback and export follow this sequence."},
      {label:"Remove from list",description:"Excludes this clip from the join; it does not delete your original file."},
      {label:"Preview",description:"Plays the source clip to confirm correct track selection."},
      {label:"Crossfade",description:"Overlaps adjacent clip edges for a smoother transition; too long a crossfade can change perceived timing."},
      {label:"Channels",description:"Match the first input, force stereo or force mono; conversion affects output layout."},
      {label:"Sample rate",description:"Follows Settings → Export when the sample-rate control is not editable on this page."},
      {label:"Join / Export",description:"Queues a new output and preserves all originals."},
    ]
  },
  {
    id:"pitcher",title:"Pitcher",availability:"Ready for desktop testing",summary:"Adjust pitch and tempo locally, and compare processed versus original audio.",
    steps:["Select an imported track.","Adjust pitch in semitones/cents and adjust tempo.","Choose duration-preserving or coupled behavior where available.","Render Preview and compare Original versus Processed.","Set export format, Export and listen for artifacts."],
    controls:[
      {label:"Pitch / semitones",description:"Moves musical pitch by half-step increments; positive increases pitch, negative decreases it."},
      {label:"Fine cents",description:"Adjusts pitch more precisely (100 cents equals one semitone)."},
      {label:"Tempo",description:"Changes playback speed or stretch factor. Large changes can sound unnatural."},
      {label:"Preserve duration",description:"Uses the granular time/pitch algorithm when enabled; quality varies with the audio."},
      {label:"Render Preview",description:"Computes an actual processed preview rather than merely changing the displayed number."},
      {label:"Original / Processed",description:"Listen to both versions before exporting; avoid comparing at mismatched volume."},
      {label:"Export / Reset",description:"Export saves the processed result; Reset returns edit controls to their defaults."},
    ]
  },
  {
    id:"key-bpm",title:"Key & BPM Finder",availability:"Ready for desktop testing",summary:"Estimate tempo and musical key from audio; findings are estimates, not guaranteed truth.",
    steps:["Select an imported track.","Run BPM detection and musical-key analysis.","Compare half-time/double-time BPM alternatives where displayed.","Apply a manual BPM or key override if listening disagrees.","Copy/export the measured or corrected results."],
    controls:[
      {label:"Analyze BPM",description:"Uses onset/autocorrelation to estimate beats per minute; rhythmic ambiguity can create half/double tempo readings."},
      {label:"Analyze Key",description:"Uses pitch-class/chroma matching. Modulations or sparse audio can make the estimate unreliable."},
      {label:"Manual BPM correction",description:"Overrides the displayed tempo based on your own beat count."},
      {label:"Manual key override",description:"Records a user-selected musical key without pretending it was detected."},
      {label:"Copy / Export",description:"Copies or downloads analysis metadata; these buttons do not modify the audio."},
    ]
  },
  {
    id:"recorder",title:"Recorder",availability:"Ready for desktop testing",summary:"Record microphone audio locally; browser/device permission is required.",
    steps:["Select a microphone device, if more than one is available.","Press Start recording and approve the microphone permission prompt.","Watch the live level meter; Pause and Resume when needed.","Press Stop, then play the recording to check it.","Save original to preserve the captured container or export a converted WAV/MP3."],
    controls:[
      {label:"Input device",description:"Selects a microphone detected by Windows/Electron. If none appears, check Windows privacy settings and the physical connection."},
      {label:"Start / Re-record",description:"Requests microphone permission and starts a new recording; re-recording replaces the current in-app take, so save it first."},
      {label:"Level meter",description:"Shows approximate input level. Avoid heavy clipping; move the microphone or lower its gain."},
      {label:"Pause / Resume",description:"Stops or resumes recording without completing the current take."},
      {label:"Stop",description:"Finalizes the microphone recording so playback/export become available."},
      {label:"Save original",description:"Saves the captured recording format without additional conversion."},
      {label:"Export as WAV / MP3",description:"Runs a conversion job; listen to the result to ensure the format and duration are correct."},
    ],caution:"A recording in the app is temporary until you explicitly save it. Never rely on the session to survive a crash."
  },
  {
    id:"karaoke",title:"Karaoke",availability:"Ready for desktop testing",summary:"Play an instrumental, view synchronized LRC lyrics, and record/mix your vocal take.",
    steps:["Import and select an instrumental track.","Optionally import an .lrc lyric file and adjust timing offset.","Start instrumental playback, then Start recording; allow mic permission if prompted.","Stop and preview the microphone take.","Save the raw take or choose Mix export format and Export mix.","Check alignment by listening to the saved mix."],
    controls:[
      {label:"Instrumental track",description:"The backing audio for playback and final mix. Choose an instrumental rather than a full mix when possible."},
      {label:"Import LRC",description:"Reads synchronized lyric timestamps from a local .lrc file; it does not extract lyrics automatically."},
      {label:"Timing offset",description:"Shifts displayed lyric timestamps relative to playback; it does not modify your audio."},
      {label:"Start / Stop / Pause / Resume",description:"Controls microphone recording; the start time is captured for instrumental alignment."},
      {label:"Save take",description:"Preserves your isolated microphone performance before mixing."},
      {label:"Mix export format",description:"Chooses the format for the combined instrumental/vocal output."},
      {label:"Export mix",description:"Stages the recorded take privately and mixes with FFmpeg; in-memory takes over 64 MiB need another workflow."},
    ],caution:"Use headphones to prevent the instrumental leaking into the microphone. A physical-microphone alignment test is still required for release acceptance."
  },
  {
    id:"remover",title:"Vocal Remover",availability:"Requires a user-provided AI model",summary:"Two-stem offline MDX-Net separation into real vocals and instrumental files. No checkpoint is bundled.",
    steps:["Import a short track in Home.","Download a lawfully obtained exact UVR-MDX-NET-Inst_HQ_5.onnx file and verify its hash.","Choose local model file in Remover.","Select Lower memory, Balanced or Thorough processing; start with Balanced.","Select a writable output directory; start separation.","Use Processing Queue to track, cancel or troubleshoot. Preview both stems and reveal them in Explorer."],
    controls:[
      {label:"Check runtime",description:"Detects the bundled Python worker. A detected worker does not prove a model is installed or will separate successfully."},
      {label:"Choose local model file",description:"Requires the exact checkpoint filename and SHA-256. Does not silently download weights or accept arbitrary unverified model files."},
      {label:"Lower memory",description:"MDX segment size 128 with default overlap; intended for memory-constrained machines, not guaranteed faster."},
      {label:"Balanced",description:"MDX segment size 256 with overlap 0.25; the baseline preset."},
      {label:"Thorough",description:"MDX segment size 256 with overlap 0.50; may use more processing without guaranteeing cleaner stems."},
      {label:"Start separation",description:"Runs genuine local inference when the worker and selected checksum-approved model are available."},
      {label:"Vocals / Instrumental preview",description:"Listen and seek each validated result. Some vocal bleed and artifacts are possible."},
      {label:"Show in folder",description:"Opens Explorer at the verified result. Retain the saved files: job history is not a project archive."},
    ],caution:"Only MDX-Net CPU two-stem inference is in scope. Demucs/RoFormer and GPU modes are not enabled. No claims of studio-grade quality are supported without listening and reference tests."
  },
  {
    id:"splitter",title:"Multi-stem Splitter",availability:"Not implemented",summary:"Shows future stem layouts only. Four- or six-stem inference is NOT executable.",
    steps:["Review the model metadata to understand supported stem names.","Use Remover for the currently implemented two-stem CPU path.","Do not expect four/six exported stem files from this page."],
    controls:[
      {label:"Track selector",description:"Choose a track for the proposed workflow; this does not start inference."},
      {label:"Stem layout",description:"Displays supported stems from registered metadata, not installed runtime capability."},
      {label:"Result slots",description:"Illustrative placeholders, not actual generated audio."},
    ],caution:"No button on this page currently performs multi-stem AI separation."
  },
  {
    id:"models",title:"Model Manager",availability:"Metadata only",summary:"Inspect and register manifests for future model integrations; registration does not enable inference.",
    steps:["Use Remover → Choose local model file for today's real MDX two-stem workflow.","In Model Manager, inspect a checkpoint to view file metadata and hash.","Validate a manifest before registering it as metadata.","Treat Download and uninstalled adapters as unavailable; do not assume a registered model is usable."],
    controls:[
      {label:"Inspect model file",description:"Reads local file metadata/format and a real digest; it never executes untrusted model code."},
      {label:"Associated config files",description:"Optional model configuration metadata; does not automatically verify model-runtime compatibility."},
      {label:"Register inspected",description:"Creates a metadata entry only, not a working AI backend."},
      {label:"Validate manifest",description:"Checks the expected schema and declared attributes; not a substitute for checking model provenance."},
      {label:"Preferred model",description:"A registry preference for future resolution; Remover still requires its separately approved ONNX checkpoint."},
      {label:"Catalog Download",description:"Disabled until verified download/integrity/runtime support exists."},
      {label:"Storage report",description:"Reflects known metadata/storage capabilities; do not treat it as a full Windows disk-use scanner."},
    ],caution:"Public model availability does not grant redistribution rights. Never bundle unknown checkpoints or assume their license."
  },
  {
    id:"queue",title:"Processing Queue",availability:"Ready for desktop testing",summary:"Monitor running audio jobs, progress, cancellation, failures and result links.",
    steps:["Start processing in an editing view.","Open Processing Queue to monitor Running, Queued or Preparing tasks.","For a long-running job, use Cancel if necessary.","For Completed, use Show output or Save to inspect the result.","Expand job logs to diagnose a failure; verify saved files before removing history."],
    controls:[
      {label:"Queued / Preparing / Running",description:"Real queue states; an indeterminate progress bar means the engine did not provide numeric progress."},
      {label:"Cancel",description:"Requests cancellation. It may take a moment to stop native subprocesses and discard partial files."},
      {label:"Completed / Show output",description:"Shows or saves a finished artifact; always listen to the saved output."},
      {label:"Job log toggle",description:"Expands informational and error messages for that specific job."},
      {label:"Remove / Clear finished",description:"Deletes finished entries from the UI, not necessarily their saved output files."},
      {label:"Previous sessions",description:"Read-only receipts from earlier launches; an Interrupted receipt is not an automatically resumable job."},
    ],caution:"Keep the destination files independently. The queue is not a substitute for a persistent project file."
  },
  {
    id:"settings",title:"Settings",availability:"Ready for desktop testing",summary:"Choose local appearance, playback and export defaults. Some AI policy controls are future-facing.",
    steps:["Choose Theme and accent to improve contrast.","Select a default export format; choose MP3 bitrate only for MP3.","Choose output sample rate and job concurrency appropriate to your machine.","Review the future model settings but use Remover's local model picker for current AI inference."],
    controls:[
      {label:"Theme / accent",description:"Changes application visual appearance. Use adequate color contrast for accessibility."},
      {label:"Default volume",description:"Changes preferred playback level, not the gain encoded into your source files."},
      {label:"Export format",description:"WAV16 is uncompressed 16-bit; WAV24 preserves more PCM precision; MP3 is lossy and smaller."},
      {label:"MP3 bitrate",description:"Controls lossy encoding rate when MP3 is selected; 320 kbps generally makes larger files than 128."},
      {label:"Sample rate",description:"Use source rate or a specified output rate; resampling does not restore missing source frequencies."},
      {label:"Concurrent jobs",description:"Higher concurrency uses more CPU/RAM. AI worker may serialize inference even if other jobs are queued."},
      {label:"Preferred model / fallback policy",description:"Registry-only preference and future default policies; there is no bundled default model."},
      {label:"Reset settings",description:"Restores local preferences to defaults. Save important outputs separately."},
    ]
  },
  {
    id:"system",title:"System Information",availability:"Ready for desktop testing",summary:"Inspect reported runtime, browser audio and device capabilities without inventing available hardware.",
    steps:["Open System Information.","Use Refresh to repeat available device/capability checks.","Check whether microphone, audio codecs and local runtime are detected.","Copy a sanitized report when asking for support; never post private paths or audio."],
    controls:[
      {label:"Refresh",description:"Re-runs environment detection where supported; a device can change after plugging in hardware."},
      {label:"Audio and microphone capability",description:"Reports supported APIs and permissions as detected, not guaranteed signal quality."},
      {label:"CPU / memory / GPU",description:"Observed hardware and browser values; GPU information does not prove CUDA/AI compatibility."},
      {label:"Copy report",description:"Copies diagnostics for issue reporting; review them before sharing."},
    ]
  },
  {
    id:"help",title:"Quick Help",availability:"Ready for desktop testing",summary:"Search this guide or open any workspace's individual controls and explanations.",
    steps:["Use the search field to find a feature or button.","Select a workspace section to see each control and a step-by-step task guide.","Use Back to workspace to return to the tool.","Press Alt+1 through Alt+6 for the documented primary workspace shortcuts."],
    controls:[
      {label:"Search help",description:"Filters the guide by feature name, instructions, button label or explanation."},
      {label:"Open workspace",description:"Navigates to the described tool without changing the audio or processing queue."},
      {label:"Page-header help (?)",description:"Opens the exact guide for the current page."},
      {label:"Navigation hover/focus hints",description:"Shows concise explanations on desktop mouse hover or keyboard focus."},
    ]
  }
];

export const HELP_BY_ID: Record<ViewId, HelpEntry> =
  Object.fromEntries(HELP_ENTRIES.map(e => [e.id,e])) as Record<ViewId, HelpEntry>;

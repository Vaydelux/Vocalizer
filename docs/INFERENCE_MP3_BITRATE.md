# AI stem MP3 bitrate acceptance

Vocalizer's Splitter and Remover use a separate Python inference/export pipeline
from native FFmpeg editor exports. This document covers its output encoding,
not neural-network quality or model rights.

## Bitrate contract

- The user-selected 128, 192, 256, or 320 kbps is validated in Electron IPC
  and again in the worker's typed protocol and Python encoder.
- An omitted bitrate from an older inference client retains the previous
  320 kbps worker fallback. New desktop requests use the selected or saved
  value; no MP3 setting should be silently changed during inference.
- HTDemucs uses the requested value for the final FFmpeg `libmp3lame -b:a`
  pass after streaming source separation.
- MDX-Net passes `output_bitrate` to `audio-separator`; its cached separator
  identity includes the selected bitrate so settings changes do not reuse an
  encoder configured for a different MP3 rate.
- WAV, 24-bit WAV, and FLAC remain lossless outputs; the MP3 bitrate setting
  must not change their encoder parameters.

## Automated acceptance

The TypeScript tests cover 128/192/256/320 kbps, invalid payload rejection,
legacy omission, and serialization through the inference worker boundary.
Model-free Python tests exercise Demucs dispatch and MDX audio-separator
configuration using a fake local model. Windows CI generates original audio,
uses the actual Python stem encoder arguments, and checks FFmpeg output using
FFprobe at 128 and 320 kbps.

These checks are not a substitute for listening to real separated stems.
Real Windows model-backed inference CI primarily qualifies the worker's WAV
path, which is intentionally unchanged.

## Physical Windows QA

Run a short authorized music file through HTDemucs and MDX-Net independently,
if the relevant approved local models are installed. Export MP3 at 128 and
320 kbps, verify the output files' codec, duration, and stream bitrate, and
compare the vocal/instrumental quality and sync by listening. Repeat a job
after changing the MP3 bitrate without restarting, to check that a cached MDX
separator does not retain the previous output setting. Confirm cancellation
leaves no unexpected partial published stems. Do not distribute model weights
without checking their redistribution permissions.

"""Validated MP3 stem encoding options shared by MDX-Net and HTDemucs.

The selected bitrate must never be silently replaced with a hard-coded 320k.
Only the four studio-supported values are accepted; reject malformed job JSON
even if an older runner bypasses Electron's Zod IPC validation.
"""
from __future__ import annotations

from errors import WorkerError

ALLOWED_MP3_BITRATES = (128, 192, 256, 320)


def require_mp3_bitrate(value: object) -> int:
    if type(value) is not int or value not in ALLOWED_MP3_BITRATES:
        raise WorkerError(
            "encoding-failed",
            "MP3 bitrate must be one of 128, 192, 256, or 320 kbps.",
        )
    return value


def stem_codec_args(output_format: str, mp3_bitrate: int = 320) -> list[str]:
    bitrate = require_mp3_bitrate(mp3_bitrate)
    codecs = {
        "wav": ["-c:a", "pcm_s16le"],
        "wav24": ["-c:a", "pcm_s24le"],
        "flac": ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24"],
        "mp3": ["-c:a", "libmp3lame", "-b:a", f"{bitrate}k"],
    }
    try:
        return codecs[output_format]
    except KeyError as exc:
        raise WorkerError("encoding-failed", "Unsupported stem output format.") from exc

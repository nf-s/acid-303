"""Rebuild the music-vocal additions without changing the legacy catalog.

Requires Python 3, numpy and FFmpeg with the Rubber Band filter. Set
GRAIN_DANCE_SOURCE_DIR to a cache directory; missing selected sources are fetched
from the official Internet Archive collection and checked against two hashes.
"""
from pathlib import Path
import hashlib
import json
import math
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
import wave

import numpy as np

ROOT = Path(__file__).resolve().parent
SOURCES = Path(os.environ.get("GRAIN_DANCE_SOURCE_DIR", "/tmp/grain-dance-sources"))
RATE = 44100
PEAK = 10 ** (-1 / 20)
ARCHIVE = "https://archive.org/download/producer-space-cc0-sample-library/"


def source_file(entry):
    path = SOURCES / entry["file"]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = ARCHIVE + urllib.parse.quote(entry["file"], safe="/")
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=60) as response:
                    content = response.read()
                path.write_bytes(content)
                break
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(attempt + 1)
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != entry["sourceSha256"]:
        raise ValueError("Source SHA256 mismatch: " + entry["file"])
    if hashlib.md5(content).hexdigest() != entry["archiveMd5"]:
        raise ValueError("Archive MD5 mismatch: " + entry["file"])
    return path


def decode(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(RATE),
        "-f", "f32le", "pipe:1",
    ])
    data = np.frombuffer(raw, dtype="<f4").astype(float)
    if not len(data) or not np.all(np.isfinite(data)):
        raise ValueError("Invalid audio: " + str(path))
    return data


def pitch_frames(data):
    """YIN-style period estimates; only sufficiently periodic frames are kept."""
    reduced = data[::4]
    sample_rate = RATE / 4
    size, hop = 1024, 110
    low, high = int(sample_rate / 1000), int(sample_rate / 70)
    frames = []
    for start in range(0, len(reduced) - size, hop):
        frame = reduced[start : start + size]
        frame = frame - np.mean(frame)
        rms = float(np.sqrt(np.mean(frame * frame)))
        if rms < 0.009:
            continue
        spectrum = np.fft.rfft(frame, size * 2)
        correlation = np.fft.irfft(spectrum * spectrum.conj())[: high + 1]
        energy = np.concatenate(([0], np.cumsum(frame * frame)))
        lags = np.arange(1, high + 1)
        difference = energy[size - lags] + energy[size] - energy[lags] - 2 * correlation[1 : high + 1]
        normalized = difference * lags / np.maximum(np.cumsum(difference), 1e-12)
        valleys = np.flatnonzero(
            (normalized[low - 1 : -2] < 0.18)
            & (normalized[low - 1 : -2] < normalized[low:-1])
            & (normalized[low - 1 : -2] <= normalized[low - 2 : -3])
        )
        if not len(valleys):
            continue
        index = int(valleys[0]) + low - 1
        lag = float(index + 1)
        denominator = normalized[index - 1] - 2 * normalized[index] + normalized[index + 1]
        if abs(denominator) > 1e-10:
            lag += (normalized[index - 1] - normalized[index + 1]) / (2 * denominator)
        frames.append((69 + 12 * math.log2(sample_rate / lag / 440), 1 - normalized[index]))
    return frames


def pitch_summary(data):
    frames = pitch_frames(data)
    if not frames:
        return None
    notes = np.array([frame[0] for frame in frames])
    return {
        "medianMidi": round(float(np.median(notes)), 4),
        "spreadSemitones": round(float(np.percentile(notes, 90) - np.percentile(notes, 10)), 4),
        "meanConfidence": round(float(np.mean([frame[1] for frame in frames])), 4),
        "voicedFrames": len(frames),
    }


def tuned(data, source_note, target_note):
    ratio = 2 ** ((target_note - source_note) / 12)
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "1",
        "-i", "pipe:0", "-af",
        "rubberband=pitch=" + format(ratio, ".12f")
        + ":formant=preserved:pitchq=quality:transients=smooth:window=long",
        "-f", "f32le", "pipe:1",
    ], input=data.astype("<f4").tobytes())
    return np.frombuffer(raw, dtype="<f4").astype(float)


def export(entry):
    path = source_file(entry)
    source = decode(path)
    start = round(entry["startSeconds"] * RATE)
    end = round(entry["endSeconds"] * RATE)
    if not 0 <= start < end <= len(source):
        raise ValueError("Crop outside source: " + entry["id"])
    data = source[start:end].copy()
    data -= np.mean(data)
    original_pitch = pitch_summary(data) if entry["pitchKind"] == "tuned-chop" else None
    if entry["pitchKind"] == "tuned-chop" and original_pitch is None:
        raise ValueError("No stable input pitch: " + entry["id"])
    shift = entry["rootNote"] - entry.get("sourceMidi", entry["rootNote"])
    if original_pitch is not None:
        data = tuned(data, entry["sourceMidi"], entry["rootNote"])
    data -= np.mean(data)
    fade_in_ms = 12 if original_pitch is not None else 3
    fade_out_ms = 18 if original_pitch is not None else 12
    fade_in = min(round(fade_in_ms * RATE / 1000), len(data) // 3)
    fade_out = min(round(fade_out_ms * RATE / 1000), len(data) // 3)
    data[:fade_in] *= np.linspace(0, 1, fade_in)
    data[-fade_out:] *= np.linspace(1, 0, fade_out)
    gain = PEAK / max(float(np.max(np.abs(data))), 1e-12)
    data *= gain
    pcm = np.rint(np.clip(data, -1, 1) * 32767).astype("<i2")
    output = ROOT / "audio" / (entry["id"] + ".wav")
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())
    if output.stat().st_size > 256 * 1024 or not 0.15 <= len(data) / RATE <= 3:
        raise ValueError("Sample exceeds playback bounds: " + entry["id"])
    final_pitch = pitch_summary(pcm.astype(float) / 32768) if original_pitch is not None else None
    if original_pitch is not None and final_pitch is None:
        raise ValueError("No stable output pitch: " + entry["id"])
    if final_pitch is not None and abs(final_pitch["medianMidi"] - entry["rootNote"]) > 0.15:
        raise ValueError("Tuned sample misses target: " + entry["id"])
    source_key = re.search(r"SHV - (.*?) - (\d+) BPM|136 BPM - (.*?)\.wav", entry["file"])
    key = source_key.group(1) or source_key.group(3) if source_key else None
    tempo = int(source_key.group(2) or 136) if source_key else None
    return {
        "id": entry["id"], "name": entry["name"], "voice": entry["bank"],
        "bank": entry["bank"], "category": entry["category"], "tonal": entry["tonal"],
        "url": "/vocals/audio/" + output.name, "duration": round(len(data) / RATE, 6),
        "sampleRate": RATE, "channels": 1, "frames": len(data),
        "rootNote": entry["rootNote"], "peak": round(float(np.max(np.abs(data))), 6),
        "rms": round(float(np.sqrt(np.mean(data * data))), 6),
        "peaks": [round(float(np.max(np.abs(chunk))), 4) for chunk in np.array_split(data, 128)],
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "pitch": {"kind": entry["pitchKind"], "before": original_pitch, "after": final_pitch},
        "source": {
            "pack": entry["file"].split("/")[2], "file": entry["file"],
            "page": "https://producerspace.com/", "license": "CC0-1.0",
            "licenseUrl": "https://producerspace.com/license",
            "licenseFile": "/vocals/licenses/producer-space-CC0.txt", "performer": None,
            "download": ARCHIVE + urllib.parse.quote(entry["file"], safe="/"),
            "sha256": entry["sourceSha256"], "archiveMd5": entry["archiveMd5"],
            "decodedDuration": round(len(source) / RATE, 6), "startSeconds": round(start / RATE, 6),
            "endSeconds": round(end / RATE, 6), "key": key, "bpm": tempo,
        },
        "processing": {
            "gainDb": round(20 * math.log10(gain), 3), "fadeInMs": fade_in_ms,
            "fadeOutMs": fade_out_ms, "pitchShiftSemitones": round(shift, 4),
            "pitchMethod": "Rubber Band, preserved formants" if original_pitch is not None else None,
        },
    }


def main():
    selection = json.loads((ROOT / "selection-v2.json").read_text())
    legacy = json.loads((ROOT / "catalog.json").read_text())
    additions = [export(entry) for entry in selection["samples"]]
    catalog = {
        "version": 2,
        "rootNoteMeaning": "Tuned chops use their measured nearest semitone, preserving the original register. Sung phrases retain their melody and use the source key's tonic as the transposition reference. Unpitched words and legacy recordings use C4 as a neutral playback reference.",
        "format": "Mono PCM16 WAV, 44.1kHz; DC removed, -1dBFS peak, edge fades.",
        "samples": legacy["samples"] + additions,
    }
    (ROOT / "catalog-v2.json").write_text(json.dumps(catalog, indent=2) + "\n")
    print(json.dumps([{"id": sample["id"], "duration": sample["duration"], "pitch": sample["pitch"]["after"]} for sample in additions], indent=2))


if __name__ == "__main__":
    main()

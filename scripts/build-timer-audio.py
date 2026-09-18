"""Build original 60/100-second Gaga ball countdown soundtracks.

Run generate-timer-voices.ps1 first on Windows. The three-second spoken intro
is followed by the exact game duration; the last ten seconds are spoken aloud.
"""

from pathlib import Path
import subprocess
import wave

import imageio_ffmpeg
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
CLIPS = ROOT / "sound" / "timer-voice-clips"
RATE = 24000
INTRO = 3
RNG = np.random.default_rng(5737)


def add_at(track, signal, second, gain=1.0):
    start = round(second * RATE)
    if start >= len(track):
        return
    end = min(len(track), start + len(signal))
    track[start:end] += signal[: end - start] * gain


def spoken(word):
    with wave.open(str(CLIPS / f"{word}.wav"), "rb") as source:
        channels, width, rate, frames = (
            source.getnchannels(), source.getsampwidth(),
            source.getframerate(), source.getnframes(),
        )
        assert width == 2, f"Expected 16-bit PCM: {word}"
        signal = np.frombuffer(source.readframes(frames), dtype="<i2").astype(np.float32)
    signal = signal.reshape(-1, channels).mean(axis=1) / 32768
    non_silent = np.flatnonzero(np.abs(signal) > 0.012)
    if len(non_silent):
        signal = signal[max(0, non_silent[0] - rate // 50): non_silent[-1] + rate // 20]
    target = max(1, round(len(signal) * RATE / rate))
    signal = np.interp(np.linspace(0, len(signal) - 1, target), np.arange(len(signal)), signal)
    # Each word must fit in one second, even when a different SAPI voice is used.
    if len(signal) > RATE * 0.84:
        signal = np.interp(
            np.linspace(0, len(signal) - 1, round(RATE * 0.84)),
            np.arange(len(signal)), signal,
        )
    peak = max(np.max(np.abs(signal)), 0.01)
    return (signal / peak * 0.42).astype(np.float32)


def tone(frequency, seconds, gain=0.1, fall=5):
    t = np.arange(round(seconds * RATE), dtype=np.float32) / RATE
    return (gain * np.sin(2 * np.pi * frequency * t) * np.exp(-fall * t)).astype(np.float32)


def build(duration):
    game_end = INTRO + duration
    track = np.zeros(round((game_end + 1.5) * RATE), dtype=np.float32)

    # Quiet, original minor-key arena bed; never covers the spoken cues.
    chords = [(146.83, 174.61, 220.00), (116.54, 146.83, 174.61),
              (130.81, 164.81, 196.00), (130.81, 164.81, 220.00)]
    for bar_start in np.arange(0, game_end, 4):
        chord = chords[int(bar_start // 4) % len(chords)]
        length = min(4, game_end - bar_start)
        t = np.arange(round(length * RATE), dtype=np.float32) / RATE
        fade = np.minimum(1, t * 3) * np.minimum(1, (length - t) * 2)
        pad = sum(np.sin(2 * np.pi * note * t) + 0.15 * np.sin(4 * np.pi * note * t)
                  for note in chord) * (0.012 * fade)
        add_at(track, pad, bar_start)

    for beat in np.arange(0, game_end, 0.5):
        t = np.arange(round(0.22 * RATE), dtype=np.float32) / RATE
        if round(beat * 2) % 4 == 0:
            phase = 2 * np.pi * (82 * t - 33 * t * t)
            drum = 0.11 * np.sin(phase) * np.exp(-24 * t)
        elif round(beat * 2) % 4 == 2:
            drum = 0.045 * RNG.standard_normal(len(t)) * np.exp(-28 * t)
        else:
            drum = 0.018 * RNG.standard_normal(len(t)) * np.exp(-65 * t)
        add_at(track, drum, beat)

    for second, word in enumerate(("three", "two", "one", "go")):
        add_at(track, spoken(word), second)
        add_at(track, tone(660 if word != "go" else 880, 0.45, 0.10), second)

    for number, word in enumerate(("ten", "nine", "eight", "seven", "six",
                                   "five", "four", "three", "two", "one")):
        second = game_end - 10 + number
        add_at(track, spoken(word), second)
        add_at(track, tone(700 + number * 24, 0.38, 0.08), second)

    # Final arena gong and whistle-like rising signal, both synthesized here.
    t = np.arange(round(1.3 * RATE), dtype=np.float32) / RATE
    gong = (0.20 * np.sin(2 * np.pi * 392 * t) +
            0.16 * np.sin(2 * np.pi * 587.33 * t) +
            0.12 * np.sin(2 * np.pi * 783.99 * t)) * np.exp(-2.2 * t)
    whistle = 0.15 * np.sin(2 * np.pi * (900 * t + 140 * t * t)) * np.exp(-5 * t)
    add_at(track, gong + whistle, game_end)

    # Leave clear space for the announcer at the beginning and in the final ten.
    for start, end in [(0, 3.8), (game_end - 10, game_end)]:
        track[round(start * RATE):round(end * RATE)] *= 0.78
    track = np.tanh(track * 1.5) * 0.88
    pcm = (track * 32767).astype("<i2")
    output = ROOT / "sound" / f"countdown-{duration}s.mp3"
    subprocess.run((imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
                    "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "pipe:0",
                    "-c:a", "libmp3lame", "-b:a", "128k", str(output)),
                   input=pcm.tobytes(), check=True)
    print(f"{output.name}: {len(track) / RATE:.2f}s, {output.stat().st_size} bytes")


if __name__ == "__main__":
    for seconds in (60, 100):
        build(seconds)

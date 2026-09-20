"""Build race-start timers from the user-supplied Colosseum Clash WAV.

The source music is not copied into the repository. The output contains three
short grid signals, one long start signal, music, the final English countdown,
and a large zero-second explosion.
"""

import argparse
from pathlib import Path
import subprocess
import wave

import imageio_ffmpeg
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path.home() / "Downloads" / "Colosseum Clash.wav"
VOICE_DIR = ROOT / "sound" / "timer-voice-clips-wild"
RATE = 48000
INTRO = 3.0


def read_wav(path):
    with wave.open(str(path), "rb") as source:
        assert source.getsampwidth() == 2
        rate, channels = source.getframerate(), source.getnchannels()
        audio = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32)
    return audio.reshape(-1, channels) / 32768, rate


def resample(audio, source_rate, target_rate):
    size = round(len(audio) * target_rate / source_rate)
    positions = np.linspace(0, len(audio) - 1, size)
    if audio.ndim == 1:
        return np.interp(positions, np.arange(len(audio)), audio)
    return np.column_stack([
        np.interp(positions, np.arange(len(audio)), audio[:, channel])
        for channel in range(audio.shape[1])
    ])


def place(track, audio, seconds, gain=1):
    start = round(seconds * RATE)
    if audio.ndim == 1:
        audio = np.column_stack([audio, audio])
    end = min(len(track), start + len(audio))
    track[start:end] += audio[:end - start] * gain


def race_light_signal():
    """Original starting-grid light cue: relay clack plus electronic horn."""
    duration = 0.42
    t = np.arange(round(duration * RATE)) / RATE
    frequency = 630
    horn = (np.sin(2 * np.pi * frequency * t) +
            0.35 * np.sin(2 * np.pi * frequency * 1.5 * t))
    envelope = np.minimum(1, t * 150) * np.exp(-8 * t)
    rng = np.random.default_rng(902)
    relay = rng.standard_normal(len(t)) * np.exp(-85 * t)
    return (0.38 * horn * envelope + 0.15 * relay).astype(np.float32)


def race_go_signal():
    """A steady, higher and louder fourth light signal; no siren sweep."""
    duration = 0.92
    t = np.arange(round(duration * RATE)) / RATE
    frequency = 880
    horn = (np.sin(2 * np.pi * frequency * t) +
            0.30 * np.sin(2 * np.pi * frequency * 1.5 * t))
    envelope = np.minimum(1, t * 150) * np.minimum(1, (duration - t) * 10)
    return (0.55 * horn * envelope).astype(np.float32)


def voice(word):
    audio, rate = read_wav(VOICE_DIR / f"{word}.wav")
    audio = audio.mean(axis=1)
    active = np.flatnonzero(np.abs(audio) > 0.012)
    audio = audio[max(0, active[0] - rate // 50):active[-1] + rate // 20]
    audio = resample(audio, rate, RATE)
    if len(audio) > round(0.82 * RATE):
        audio = resample(audio, len(audio), round(0.82 * RATE))
    audio = audio / max(np.max(np.abs(audio)), 0.01)
    # Mild saturation and a short room reflection keep the energetic call in
    # the same acoustic space as the source music without sounding detached.
    audio = np.tanh(audio * 1.55) * 0.46
    result = np.zeros((len(audio) + round(0.14 * RATE), 2), dtype=np.float32)
    result[:len(audio), :] += audio[:, None]
    for delay, gain, side in ((0.055, 0.13, 0), (0.105, 0.08, 1)):
        offset = round(delay * RATE)
        result[offset:offset + len(audio), side] += audio * gain
    return result


def impact():
    rng = np.random.default_rng(5737)
    t = np.arange(round(1.2 * RATE)) / RATE
    boom = 0.25 * np.sin(2 * np.pi * (75 * t - 17 * t * t)) * np.exp(-4 * t)
    crash = 0.10 * rng.standard_normal(len(t)) * np.exp(-5 * t)
    return (boom + crash).astype(np.float32)


def giant_explosion():
    """Layered original explosion: crack, fireball, sub shockwave and debris."""
    duration = 3.4
    t = np.arange(round(duration * RATE)) / RATE
    rng_left = np.random.default_rng(5737)
    rng_right = np.random.default_rng(7357)
    layers = []
    for rng in (rng_left, rng_right):
        noise = rng.standard_normal(len(t))
        fire = np.convolve(noise, np.ones(55) / 55, mode="same") * np.exp(-1.45 * t)
        crack = (noise - np.convolve(noise, np.ones(13) / 13, mode="same")) * np.exp(-38 * t)
        phase = 2 * np.pi * np.cumsum(72 - 45 * np.minimum(t / 1.7, 1)) / RATE
        shock = np.sin(phase) * np.exp(-1.25 * t)
        layers.append(0.95 * crack + 2.2 * fire + 0.48 * shock)
    explosion = np.column_stack(layers)
    explosion /= max(np.max(np.abs(explosion)), 0.01)
    return (explosion * 0.94).astype(np.float32)


def prepare_music(source_music, game_seconds):
    """Use the approved opening and a shared energetic final-ten-second phrase."""
    body_seconds = game_seconds - 10
    body_start = 11.5
    body = source_music[round(body_start * RATE):round((body_start + body_seconds) * RATE)]
    crossfade = 0.6
    final_start = 23.5
    final_music = source_music[
        round((final_start - crossfade) * RATE):round((final_start + 10) * RATE)
    ].copy()
    overlap = round(crossfade * RATE)
    fade = np.linspace(0, 1, overlap, dtype=np.float32)[:, None]
    final_music[:overlap] = body[-overlap:] * (1 - fade) + final_music[:overlap] * fade
    return np.concatenate([body[:-overlap], final_music], axis=0)


def build(game_seconds, output, source_path=SOURCE):
    music, music_rate = read_wav(source_path)
    music = resample(music, music_rate, RATE)
    music = prepare_music(music, game_seconds)
    length = INTRO + game_seconds + 3.4
    music_track = np.zeros((round(length * RATE), 2), dtype=np.float32)
    effects_track = np.zeros_like(music_track)

    place(music_track, music, INTRO, 0.78)
    for second in (0, 0.78, 1.56):
        place(effects_track, race_light_signal(), second)
    place(effects_track, race_go_signal(), 2.30)
    place(effects_track, impact(), INTRO, 1.10)

    final_start = INTRO + game_seconds - 10
    final_words = ("ten", "nine", "eight", "seven", "six", "five",
                   "four", "three", "two", "one")
    for index, word in enumerate(final_words):
        second = final_start + index
        # The original music remains at a constant level throughout the final
        # countdown; only the referee voice is layered over it.
        place(effects_track, voice(word), second)
    place(effects_track, giant_explosion(), INTRO + game_seconds, 1.85)

    # Process independently: speech can never trigger compression or ducking on
    # the original music. A single final gain is applied to the entire preview.
    music_track = np.tanh(music_track * 1.02) * 0.90
    effects_track = np.tanh(effects_track * 1.08) * 0.92
    track = music_track + effects_track
    track *= 0.90 / max(np.max(np.abs(track)), 0.90)
    pcm = (track * 32767).astype("<i2")
    subprocess.run((imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
                    "-f", "s16le", "-ar", str(RATE), "-ac", "2", "-i", "pipe:0",
                    "-c:a", "libmp3lame", "-b:a", "192k", str(output)),
                   input=pcm.tobytes(), check=True)
    print(f"{output.name}: {length:.1f}s, {output.stat().st_size} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--game-seconds", type=int, default=22)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path,
                        default=ROOT / "sound" / "colosseum-clash-race-preview-v4.mp3")
    args = parser.parse_args()
    if args.game_seconds < 10:
        parser.error("game seconds must be at least 10")
    build(args.game_seconds, args.output, args.source)

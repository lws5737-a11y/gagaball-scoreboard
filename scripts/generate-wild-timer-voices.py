"""Generate energetic English countdown calls for the timer preview."""

import asyncio
from pathlib import Path
import subprocess

import edge_tts
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "sound" / "timer-voice-clips-wild"
WORDS = ("ten", "nine", "eight", "seven", "six", "five",
         "four", "three", "two", "one")


async def render(word):
    temporary = OUTPUT / f"{word}.mp3"
    output = OUTPUT / f"{word}.wav"
    # Keep the delivery energetic without pushing the voice too far below the
    # musical range of the supplied track.
    speech = edge_tts.Communicate(
        word.upper() + "!", "en-US-GuyNeural",
        rate="+18%", volume="+8%", pitch="-4Hz",
    )
    await speech.save(str(temporary))
    subprocess.run((imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
                    "-i", str(temporary), "-ac", "1", "-ar", "48000",
                    "-c:a", "pcm_s16le", str(output)), check=True)
    temporary.unlink()
    print(output.name)


async def main():
    OUTPUT.mkdir(exist_ok=True)
    for word in WORDS:
        await render(word)


if __name__ == "__main__":
    asyncio.run(main())

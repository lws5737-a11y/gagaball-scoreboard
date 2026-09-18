"""Create the original English spoken cues used by build-timer-audio.py.

Requires edge-tts and imageio-ffmpeg when regenerating the committed audio.
The running web app does not call any speech service.
"""

import asyncio
from pathlib import Path
import subprocess

import edge_tts
import imageio_ffmpeg


OUTPUT = Path(__file__).resolve().parents[1] / "sound" / "timer-voice-clips"
WORDS = ("three", "two", "one", "go", "ten", "nine", "eight",
         "seven", "six", "five", "four")


async def render(word):
    mp3 = OUTPUT / f"{word}.mp3"
    wav = OUTPUT / f"{word}.wav"
    speaker = edge_tts.Communicate(word.capitalize() + "!", "en-US-GuyNeural", rate="+10%")
    await speaker.save(str(mp3))
    subprocess.run((imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
                    "-i", str(mp3), "-ac", "1", "-ar", "24000",
                    "-c:a", "pcm_s16le", str(wav)), check=True)
    mp3.unlink()
    print(f"Generated {wav.name}")


async def main():
    OUTPUT.mkdir(exist_ok=True)
    for word in WORDS:
        await render(word)


if __name__ == "__main__":
    asyncio.run(main())

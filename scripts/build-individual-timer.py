"""Build individual match cues. Requires numpy, imageio-ffmpeg and the existing voice clips."""
import argparse
import runpy
import subprocess
from pathlib import Path

import numpy as np
import imageio_ffmpeg

root = Path(__file__).resolve().parents[1]
lib = runpy.run_path(str(root / "scripts/build-colosseum-clash-preview.py"))
rate = lib["RATE"]
place = lib["place"]
def read_source(path):
    raw = subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(path),
                                   "-ar", str(rate), "-ac", "2", "-f", "f32le", "-"])
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2)


def build(seconds, source):
    end = 3 + seconds
    track = np.zeros(((end*rate)+round(4.5*rate),2),np.float32)
    for start in (0,.78,1.56):
        t = np.arange(round(.17*rate))/rate
        reference_beep = .18*np.sin(2*np.pi*1000*t)*np.clip(t/.006,0,1)*np.clip((.17-t)/.012,0,1)
        place(track,reference_beep,start)
        place(track,lib["race_light_signal"](),start,.82)
    place(track,lib["race_go_signal"](),2.30,.92)
    # Keep the music itself. Avoid the source's opening beeps and closing cues.
    bed = source[round(5.4*rate):round(5.4*rate)+seconds*rate].copy()
    if seconds == 100:
        # Repeat an earlier musical phrase, matching the waveform at the join.
        join = 60*rate
        overlap = round(.08*rate)
        mono = bed.mean(axis=1)
        pattern = mono[join-overlap:join:8]
        search = mono[32*rate:38*rate:8]
        energy = np.convolve(search**2, np.ones(len(pattern)), mode="valid")
        best = np.argmax(np.correlate(search, pattern, mode="valid") / np.sqrt(energy+1e-8))
        start = 32*rate + int(best)*8
        fade = np.linspace(0,1,overlap)[:,None]
        bed[join-overlap:join] = bed[join-overlap:join]*(1-fade) + bed[start:start+overlap]*fade
        bed[join:] = bed[start+overlap:start+overlap+len(bed)-join].copy()
    assert len(bed) == seconds*rate
    bed *= .63
    bed[-round(.06*rate):] *= np.linspace(1,0,round(.06*rate))[:,None]
    place(track,bed,3)
    for i,word in enumerate("ten nine eight seven six five four three two one".split()):
        place(track,lib["voice"](word),end-10+i,1.35)
    t=np.arange(round(4.5*rate))/rate
    pitch=103.83*(1-.17*np.exp(-t*6)+.006*np.sin(2*np.pi*4.3*t))
    phase=2*np.pi*np.cumsum(pitch)/rate
    env=np.minimum(1,t/.13)*np.clip((4.5-t)/.8,0,1)**2
    horn=sum(w*np.sin(h*phase+.018*h*np.sin(2*np.pi*1.7*t)) for h,w in enumerate([0,.38,.34,.24,.18,.11,.08,.05,.035]))
    place(track,env*horn*(.86+.08*np.sin(t*3)),end,.78)
    pcm=(track*(.94/max(.94,np.abs(track).max()))*32767).astype("<i2")
    output=root/"sound"/f"countdown-individual-{seconds}s.mp3"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),"-y","-loglevel","error","-f","s16le","-ar",str(rate),"-ac","2","-i","pipe:0","-c:a","libmp3lame","-b:a","160k",str(output)],input=pcm.tobytes(),check=True)


if __name__=="__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    source = read_source(parser.parse_args().source)
    for duration in (60,100):
        build(duration, source)

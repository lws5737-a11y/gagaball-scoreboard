"""Build individual match cues. Requires numpy, imageio-ffmpeg and the existing voice clips."""
import runpy
import subprocess
from pathlib import Path

import numpy as np
import imageio_ffmpeg

root = Path(__file__).resolve().parents[1]
lib = runpy.run_path(str(root / "scripts/build-colosseum-clash-preview.py"))
rate = lib["RATE"]
place = lib["place"]
beat = 60 / 174


def note(midi, length, kind):
    t = np.arange(round(length * rate)) / rate
    f = 440 * 2 ** ((midi - 69) / 12)
    phase = 2 * np.pi * f * t
    weights = {"bass": [1,.38,.18], "lead": [1,.55,.27,.18,.08], "chop": [1,.45,.21,.15]}[kind]
    wave = sum(w * np.sin((i+1)*phase) for i,w in enumerate(weights))
    return wave * np.minimum(1,t/.006) * np.exp(-t*(7 if kind=="bass" else 10)) * np.clip((length-t)/.025,0,1)


def build(seconds):
    rng = np.random.default_rng(5737)
    end = 3 + seconds
    track = np.zeros(((end*rate)+round(4.5*rate),2),np.float32)
    for start in (0,.78,1.56):
        t = np.arange(round(.17*rate))/rate
        reference_beep = .18*np.sin(2*np.pi*1000*t)*np.clip(t/.006,0,1)*np.clip((.17-t)/.012,0,1)
        place(track,reference_beep,start)
        place(track,lib["race_light_signal"](),start,.82)
    place(track,lib["race_go_signal"](),2.30,.92)
    drums = np.arange(round(.28*rate))/rate
    kick = .39*np.sin(2*np.pi*(51*drums+2.3*(1-np.exp(-35*drums))))*np.exp(-15*drums)
    bed = np.zeros((seconds*rate,2),np.float32)
    for i,when in enumerate(np.arange(0,seconds,beat/2)):
        bar,step = divmod(i,8)
        base = [40,40,43,38,40,45,43,38][bar%8]
        if step in (0,4,7):
            place(bed,kick,when,1 if step!=7 else .6)
        noise = rng.normal(size=len(drums))
        if step in (2,6):
            place(bed,(.13*noise+.16*np.sin(2*np.pi*182*drums))*np.exp(-24*drums),when)
        place(bed,.029*np.diff(noise,prepend=0)*np.exp(-drums*(40 if step==7 else 95)),when)
        if step in (0,3,4,6):
            place(bed,note(base+(7 if step==6 else 0),beat*.77,"bass"),when,.20)
        if step in (1,5,7):
            for interval in (12,19):
                place(bed,note(base+interval,.13,"chop"),when,.065)
        if when<seconds-10 and step in (0,2,3,5,6) and bar%8 not in (3,7):
            pitch=base+24+([0,0,3,7,0,10,7,0] if bar%4<2 else [7,0,10,12,0,7,3,0])[step]
            riff=note(pitch,beat*.81,"lead")
            place(bed,riff,when,.14)
            if when+.095<seconds: place(bed,riff,when+.095,.031)
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
    for duration in (60,100):
        build(duration)

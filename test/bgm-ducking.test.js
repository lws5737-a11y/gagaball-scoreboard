import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function setup() {
    const nodes = Object.fromEntries(['class-selection-screen', 'title-audio-toggle', 'app-container', 'timerScreen', 'gagaDrawModal', 'rouletteModal', 'event-loading-overlay', 'gaga-view-rank'].map(id => [id, {
        hidden: !['app-container'].includes(id), style: { display: 'none' },
        classList: { contains() { return nodes[id].hidden; } }
    }]));
    class Audio {
        paused = true; ended = false; currentTime = 0; volume = 1; events = {};
        addEventListener(event, fn) { this.events[event] = fn; }
        play() { this.paused = false; this.ended = false; this.events.play?.(); return Promise.resolve(); }
        pause() { this.paused = true; this.events.pause?.(); }
        finish() { this.paused = true; this.ended = true; this.events.ended?.(); }
    }
    const ctx = vm.createContext({ Audio, window: {}, localStorage: { getItem: () => null },
        document: { getElementById: id => nodes[id] }, currentTab: 'gagaball' });
    vm.runInContext(source.slice(source.indexOf('const storedVolume'), source.indexOf('function applyGlobalVolume')), ctx);
    const tracks = vm.runInContext('audioFiles', ctx);
    ctx.syncBackgroundMusic(); tracks.waiting.currentTime = 42;
    return { ctx, nodes, tracks };
}

for (const overlay of ['event-loading-overlay', 'rouletteModal']) test(`${overlay} lowers BGM without pausing or restarting it`, () => {
    const { ctx, nodes, tracks } = setup();
    nodes[overlay].hidden = false; nodes[overlay].style.display = 'flex';
    ctx.syncBackgroundMusic(); ctx.window.playMP3('spinner');
    assert.equal(tracks.waiting.paused, false);
    assert.equal(tracks.waiting.currentTime, 42);
    assert.ok(Math.abs(tracks.waiting.volume - 0.8 * 0.3 * 0.35) < 1e-9);
    ctx.window.stopMP3('spinner'); ctx.window.playMP3('fanfare');
    nodes[overlay].hidden = true; nodes[overlay].style.display = 'none';
    ctx.syncBackgroundMusic();
    assert.ok(tracks.waiting.volume < 0.24, 'result effect still ducks music');
    tracks.fanfare.finish();
    assert.equal(tracks.waiting.volume, 0.24);
    assert.equal(tracks.waiting.currentTime, 42);
});

test('volume adjustment retains ducking, and timer/global mute still stop waiting BGM', () => {
    const { ctx, nodes, tracks } = setup();
    ctx.window.playMP3('goodresult'); ctx.window.globalVolume = 0.5;
    ctx.syncBackgroundMusic();
    assert.equal(tracks.waiting.volume, 0.5 * 0.3 * 0.35);
    nodes.timerScreen.style.display = 'block'; ctx.syncBackgroundMusic();
    assert.equal(tracks.waiting.paused, true);
    nodes.timerScreen.style.display = 'none'; ctx.window.isGlobalMuted = true;
    ctx.syncBackgroundMusic(); assert.equal(tracks.waiting.paused, true);
});

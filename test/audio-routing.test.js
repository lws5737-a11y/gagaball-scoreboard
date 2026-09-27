import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('waiting music and both champion timer soundtracks are bundled', async () => {
    for (const filename of ['pixels-in-motion.mp3', 'countdown-champions-60s.mp3', 'countdown-champions-100s.mp3']) {
        const sound = await readFile(new URL(`../sound/${filename}`, import.meta.url));
        assert.ok(sound.length > 100_000, `${filename} is unexpectedly small`);
        assert.ok(sound.subarray(0, 3).toString() === 'ID3' || sound[0] === 0xff);
    }
});

test('champions use their own timers and waiting music does not overlap a timer', async () => {
    const script = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    assert.match(script, /currentDrawIsChampions = true;[\s\S]*?window\.stopMP3\('waiting'\)/);
    assert.match(script, /window\.executeGagaDraw = function[\s\S]*?currentDrawIsChampions = false/);
    assert.match(script, /new Audio\(`sound\/countdown-\$\{currentDrawIsChampions \? 'champions-' : ''\}\$\{duration\}s\.mp3`\)/);
    assert.match(script, /window\.openGagaTimer = function[\s\S]*?window\.stopMP3\('waiting'\)/);
    assert.match(script, /audioFiles\.waiting\.loop = true/);
});

test('volume controls cover title and game screens', async () => {
    const [html, script] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../app.js', import.meta.url), 'utf8')
    ]);
    for (const id of ['title-volume-slider', 'header-volume-slider']) assert.ok(html.includes(`id="${id}"`));
    assert.match(script, /activeTimerAudio\.volume = window\.globalVolume/);
    assert.match(script, /masterGain\.gain\.setValueAtTime/);
    assert.match(script, /audio\.volume = window\.globalVolume/);
});

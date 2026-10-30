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

test('champions use their own timers while individual results continue waiting music', async () => {
    const script = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    assert.match(script, /currentDrawIsChampions = true;[\s\S]*?window\.stopMP3\('waiting'\)/);
    assert.match(script, /window\.executeGagaDraw = function[\s\S]*?currentDrawIsChampions = false/);
    assert.match(script, /const path = `sound\/countdown-\$\{currentDrawIsChampions \? 'champions-' : ''\}\$\{duration\}s\.mp3`/);
    assert.match(script, /window\.openGagaTimer = function[\s\S]*?window\.stopMP3\('waiting'\)/);
    assert.match(script, /audioFiles\.waiting\.loop = true/);
    assert.match(script, /draw\.style\.display !== 'flex' \|\| !currentDrawIsChampions/);
    assert.match(script, /window\.executeGagaDraw = function[\s\S]*?window\.showFloatingRouletteBtn\('individual'\);\s*syncBackgroundMusic\(\)/);
});

test('inline volume controls cover title, game, and timer screens with a quieter waiting track', async () => {
    const [html, script] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../app.js', import.meta.url), 'utf8')
    ]);
    for (const id of ['title-volume-slider', 'header-volume-slider', 'timer-volume-slider']) assert.ok(html.includes(`id="${id}"`));
    assert.doesNotMatch(html, /id="(?:header|title)-volume-panel"/);
    assert.match(script, /const WAITING_BGM_GAIN = 0\.3/);
    assert.match(script, /audio\.volume = getAudioVolume\(key\)/);
    assert.match(script, /activeTimerAudio\.volume = window\.globalVolume/);
    assert.match(script, /masterGain\.gain\.setValueAtTime/);
});

test('draw roulette retains its transparent icon and team view exposes the mission button', async () => {
    const [html, script, icon] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../app.js', import.meta.url), 'utf8'),
        readFile(new URL('../images/gaga-roulette-icon.png', import.meta.url))
    ]);
    assert.equal(icon.subarray(1, 4).toString(), 'PNG');
    assert.equal(icon[25], 6, 'wheel icon must retain alpha transparency');
    assert.match(html, /id="floating-roulette-btn"[^>]*draw-roulette-button[^>]*><img src="images\/gaga-roulette-icon\.png"/);
    assert.match(script, /class="game-action referee-action matchup-mission-button"[^`]*팀전 미션 룰렛/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('title artwork opens a hidden class panel and starts the anthem on click', async () => {
    const [html, script, logo] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../app.js', import.meta.url), 'utf8'),
        readFile(new URL('../images/gagaball-title-logo.png', import.meta.url))
    ]);

    assert.equal(logo.subarray(1, 4).toString(), 'PNG');
    assert.ok(logo.length > 100_000);
    assert.equal(logo[25], 6, 'title artwork should keep a transparent RGBA background');
    assert.match(html, /id="title-start-button"[^>]*onclick="window\.openStartupClassPanel\(\)"/);
    assert.match(html, /src="images\/gagaball-title-logo\.png" alt="동산초 가가볼 콜로세움 made by 우석쌤"/);
    assert.match(html, /id="startup-class-panel" class="hidden"/);
    assert.match(script, /window\.openStartupClassPanel = function\(\) \{[\s\S]*?window\.playMP3\('anthem'\);[\s\S]*?panel\.classList\.remove\('hidden'\);/);
    const firstInteraction = script.match(/const handleFirstInteraction = \(\) => \{([\s\S]*?)\n\};/);
    assert.ok(firstInteraction);
    assert.doesNotMatch(firstInteraction[1], /playMP3\('anthem'\)/, 'login or generic clicks should not start the title music');
});

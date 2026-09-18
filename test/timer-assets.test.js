import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

test('both timer soundtracks and desktop/mobile backgrounds are bundled', async () => {
    for (const seconds of [60, 100]) {
        const sound = await readFile(new URL(`../sound/countdown-${seconds}s.mp3`, import.meta.url));
        assert.ok(sound.length > 100_000, `${seconds}s soundtrack is unexpectedly small`);
        assert.ok(sound.subarray(0, 3).toString() === 'ID3' || sound[0] === 0xff);
    }
    for (const image of ['gagaball-colosseum-timer.png', 'gagaball-colosseum-timer-mobile.png']) {
        const source = new URL(`../images/${image}`, import.meta.url);
        const data = await readFile(source);
        assert.equal(data.subarray(1, 4).toString(), 'PNG');
        assert.ok((await stat(source)).size > 100_000);
    }
});

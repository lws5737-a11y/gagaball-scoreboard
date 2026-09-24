import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

test('both timer soundtracks and school-emblem desktop/mobile backgrounds are bundled', async () => {
    for (const seconds of [60, 100]) {
        const sound = await readFile(new URL(`../sound/countdown-${seconds}s.mp3`, import.meta.url));
        assert.ok(sound.length > 100_000, `${seconds}s soundtrack is unexpectedly small`);
        assert.ok(sound.subarray(0, 3).toString() === 'ID3' || sound[0] === 0xff);
    }
    const styles = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    for (const image of ['gagaball-colosseum-timer-emblem.png', 'gagaball-colosseum-timer-mobile-emblem.png']) {
        const source = new URL(`../images/${image}`, import.meta.url);
        const data = await readFile(source);
        assert.equal(data.subarray(1, 4).toString(), 'PNG');
        assert.ok((await stat(source)).size > 100_000);
        assert.ok(styles.includes(image));
    }
});

test('class selection uses the bundled cheering crowd background', async () => {
    const styles = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    for (const image of ['gagaball-colosseum-class-cheering-emblem.png', 'gagaball-colosseum-class-cheering-mobile-emblem.png']) {
        const data = await readFile(new URL(`../images/${image}`, import.meta.url));
        assert.equal(data.subarray(1, 4).toString(), 'PNG');
        assert.ok(data.length > 100_000);
        assert.ok(styles.includes(image));
    }
    assert.match(styles, /\.class-selection-backdrop\s*\{[^}]*gagaball-colosseum-class-cheering-emblem\.png/);
    const schoolEmblem = await readFile(new URL('../images/dongsan-school-emblem.png', import.meta.url));
    assert.equal(schoolEmblem.subarray(1, 4).toString(), 'PNG');
});

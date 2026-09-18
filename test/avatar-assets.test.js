import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const avatarDirectory = new URL('../images/avatars/v2/', import.meta.url);

test('new avatar set has 50 valid WebP files for each gender', async () => {
    const files = await readdir(avatarDirectory);
    const hashes = new Set();

    for (const gender of ['boy', 'girl']) {
        const expected = Array.from({ length: 50 }, (_, index) =>
            `${gender}_${String(index + 1).padStart(2, '0')}.webp`
        );
        assert.deepEqual(
            files.filter(file => file.startsWith(`${gender}_`) && file.endsWith('.webp')).sort(),
            expected
        );

        for (const filename of expected) {
            const image = await readFile(new URL(filename, avatarDirectory));
            assert.ok(image.length > 1000, `${filename} is unexpectedly small`);
            assert.equal(image.toString('ascii', 0, 4), 'RIFF', `${filename} is not a WebP file`);
            assert.equal(image.toString('ascii', 8, 12), 'WEBP', `${filename} is not a WebP file`);
            const hash = createHash('sha256').update(image).digest('hex');
            assert.ok(!hashes.has(hash), `${filename} duplicates another avatar`);
            hashes.add(hash);
        }
    }
});

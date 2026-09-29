import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('hall of fame uses a six-second paged grid with manual and pause controls', async () => {
    const [script, css] = await Promise.all([
        readFile(new URL('../app.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8')
    ]);
    assert.match(script, /const RANK_PAGE_INTERVAL = 6000/);
    assert.match(script, /buildRankingPages\(classData\[currentClass\] \|\| \[\], rankPageSize\)/);
    assert.match(script, /onclick="window\.changeRankingPage\(-1\)"/);
    assert.match(script, /onclick="window\.changeRankingPage\(1\)"/);
    assert.match(script, /onclick="window\.toggleRankingAutoplay\(\)"/);
    assert.match(script, /rank-page-exit/);
    assert.match(script, /rank-page-enter/);
    assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(css, /grid-template-rows: repeat\(3, clamp\(/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.doesNotMatch(script, /gaga-ranking-list|rankAutoScrollInterval/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('hall of fame uses a six-second paged grid with manual and pause controls', async () => {
    const [script, css, podium] = await Promise.all([
        readFile(new URL('../app.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8'),
        readFile(new URL('../images/gagaball-rank-podium.png', import.meta.url))
    ]);
    assert.match(script, /const RANK_PAGE_INTERVAL = 6000/);
    assert.match(script, /buildRankingPages\(roster, rankPageSize\)/);
    assert.match(script, /onclick="window\.changeRankingPage\(-1\)"/);
    assert.match(script, /onclick="window\.changeRankingPage\(1\)"/);
    assert.match(script, /onclick="window\.toggleRankingAutoplay\(\)"/);
    assert.match(script, /rank-page-exit/);
    assert.match(script, /rank-page-enter/);
    assert.match(script, /images\/dongsan-school-emblem\.png/);
    assert.doesNotMatch(script, /4번째 학생부터/);
    assert.match(css, /grid-template-columns: repeat\(var\(--rank-columns, 5\), minmax\(0, 1fr\)\)/);
    assert.match(css, /grid-template-rows: repeat\(var\(--rank-rows, 3\), minmax\(0, 1fr\)\)/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.doesNotMatch(script, /gaga-ranking-list|rankAutoScrollInterval/);
    assert.equal(podium.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(podium.readUInt32BE(16) > podium.readUInt32BE(20) * 2);
    assert.equal(podium[25], 6, 'podium must preserve transparent RGBA pixels');
});

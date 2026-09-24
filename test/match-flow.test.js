import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('class picker, participant actions, and roulette timer controls are wired into their screens', async () => {
    const [html, script, css] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../app.js', import.meta.url), 'utf8'),
        readFile(new URL('../style.css', import.meta.url), 'utf8')
    ]);
    assert.match(script, /rowDiv\.className = "startup-grade-row"/);
    assert.match(css, /\.startup-grade-row\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
    assert.match(html, /id="participant-actions-fab"/);
    assert.match(script, /window\.assignSelectedReferees = function\(\)/);
    assert.match(script, /window\.startChampionsTournament = function\(\)/);
    assert.match(script, /limitSelectedReferees\(picked, available\.slice\(actualDrawCount\), 1\)/);
    assert.match(script, /getRefereeEligibleTeams\(teams\)/);
    assert.doesNotMatch(html, /champions-fab-container/);
    assert.doesNotMatch(script, /toggleChampionSelection|window\.toggleReferee/);
    assert.match(html, /id="gaga-draw-mission-result"/);
    assert.match(html, /id="team-global-mission-result"/);
    assert.match(html, /onclick="window\.openTimerFromRoulette\(100\)"/);
    assert.match(html, /onclick="window\.openTimerFromRoulette\(60\)"/);
    assert.doesNotMatch(html, /룰렛 돌리기!/);
    assert.match(script, /setTimeout\(\(\) => \{ window\.drawRoulette\(\); window\.spinRoulette\(\); \}, 100\)/);
    assert.match(script, /window\.openTimerFromRoulette = function\(duration\)/);
    assert.match(script, /teamMissionResults\[spinMatchupId \|\| 'global'\] = result/);
    assert.match(script, /class="premium-score-btn minus"/);
    assert.match(script, /class="premium-score-btn plus"/);
    assert.match(css, /\.king-crown\s*\{[^}]*top:\s*-25%/);
});

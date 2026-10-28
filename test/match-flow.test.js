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
    assert.doesNotMatch(html, /id="participant-actions-fab"/);
    assert.match(html, /window\.openPlayerPicker\('champions'\)/);
    assert.match(script, /window\.assignSelectedReferees = function\(\)/);
    assert.match(script, /window\.startChampionsTournament = function\(\)/);
    assert.match(script, /getIndividualRefereeLimit\(classData\[currentClass\]\)/);
    assert.match(script, /limitSelectedReferees\(picked, available\.slice\(actualDrawCount\), refereeLimit\)/);
    assert.match(script, /getRefereeEligibleTeams\(teams\)/);
    assert.match(script, /getTeamRefereePlan\(available, numTeams\)/);
    assert.match(html, /id="team-referee-status"/);
    assert.match(script, /2팀전 예외: 모든 심판이 출전/);
    assert.doesNotMatch(html, /champions-fab-container/);
    assert.doesNotMatch(script, /toggleChampionSelection|window\.toggleReferee/);
    assert.match(html, /id="gaga-draw-mission-result"/);
    assert.match(html, /id="team-global-mission-result"/);
    assert.doesNotMatch(html, /openTimerFromRoulette|roulette-timer-actions/);
    assert.match(script, /rouletteAutoCloseTimer = setTimeout\(\(\) => window\.closeRouletteModal\(true\), 3000\)/);
    assert.match(script, /pendingWantedReveal = isWantedMission\(result\)/);
    assert.match(script, /revealWantedStudent\(\)/);
    const drawCardMarkup = script.slice(script.indexOf('const generateGridCards'), script.indexOf('let wantedRevealInterval'));
    assert.match(drawCardMarkup, /draw-result-avatar[\s\S]*wanted-mark[\s\S]*draw-result-name/);
    assert.doesNotMatch(drawCardMarkup, /wanted-overlay|wanted-subtitle/);
    assert.match(script, /toggleTeamKingSelection\(team\.members, memberNo\)/);
    assert.match(html, /id="wanted-reveal-overlay"/);
    assert.match(css, /\.roulette-result-summary\.roulette-winning/);
    assert.match(css, /#timerSelectModal\s*\{\s*z-index:\s*10000/);
    assert.match(script, /id="modal-score-\$\{s\.no\}"[^`]*\$\{s\.score \|\| 0\}<\/span>/);
    assert.match(script, /\$\{m\.score \|\| 0\}\$\{animHTML\}<\/span>/);
    assert.doesNotMatch(html, /룰렛 돌리기!/);
    assert.match(script, /rouletteStartTimer = setTimeout\(\(\) => \{/);
    assert.match(script, /window\.drawRoulette\(\);\s*window\.spinRoulette\(\);/);
    assert.doesNotMatch(script, /window\.openTimerFromRoulette/);
    assert.match(script, /teamMissionResults\[spinMatchupId \|\| 'global'\] = result/);
    assert.match(script, /class="premium-score-btn minus"/);
    assert.match(script, /class="premium-score-btn plus"/);
    assert.match(css, /\.king-crown\s*\{[^}]*top:\s*-25%/);
});

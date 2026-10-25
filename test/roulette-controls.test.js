import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('manual wanted selection replaces the previous student and allows deselection', () => {
    const cards = ['민수', '지아', '준수'].map(name => {
        const classes = new Set();
        return { attributes: {}, classList: {
            contains: key => classes.has(key), remove: key => classes.delete(key),
            toggle: (key, active) => active ? classes.add(key) : classes.delete(key)
        }, querySelector: () => ({ innerText: name }), setAttribute(key, value) { this.attributes[key] = value; } };
    });
    const ctx = vm.createContext({ document: { querySelectorAll: () => cards }, window: { playStampSound() {}, playBumpSound() {} } });
    vm.runInContext(section('window.toggleWantedEffect = function', 'window.handleWantedEffectKey = function'), ctx);
    const click = card => ctx.window.toggleWantedEffect({ currentTarget: card, target: { closest: () => null } });
    click(cards[0]); click(cards[1]);
    assert.deepEqual(cards.map(card => card.attributes['aria-pressed']), ['false', 'true', 'false']);
    click(cards[1]);
    assert.equal(cards.filter(card => card.classList.contains('wanted-active')).length, 0);
});

for (const type of ['individual', 'team']) test(`${type} roulette highlights its winner then closes after three seconds`, () => {
    const timers = [];
    const classes = new Set();
    const summary = { classList: { add: value => classes.add(value) } };
    let closed = false;
    const ctx = vm.createContext({
        currentMissions: [{ text: '미션', desc: '', weight: 1 }], currentMissionsType: type,
        isSpinning: false, currentRouletteRotation: 0, rouletteEditRequested: false,
        rouletteAutoCloseTimer: null, teamMissionResults: {}, individualMissionResult: null, pendingWantedReveal: false,
        validateMissions: missions => ({ valid: true, missions }), persistMatch() {},
        missionMarkup: result => result.text, isWantedMission: () => false,
        setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
        document: { getElementById: id => id === 'rouletteCanvas' ? { style: {} } : summary },
        window: { playMP3() {}, stopMP3() {}, renderGagaTeamView() {}, renderIndividualMissionResult() {}, closeRouletteModal(force) { closed = force; } }
    });
    vm.runInContext(section('window.spinRoulette = function', 'function missionMarkup'), ctx);
    ctx.window.spinRoulette();
    timers.find(timer => timer.delay === 5000).fn();
    assert.ok(classes.has('roulette-winning'));
    assert.equal(closed, false);
    timers.find(timer => timer.delay === 3000).fn();
    assert.equal(closed, true);
    assert.equal(type === 'team' ? ctx.teamMissionResults.global.text : ctx.individualMissionResult.text, '미션');
});

test('editing requested during a spin is queued, then opens an independent mission draft', () => {
    const modal = { style: {} }, summary = {};
    let closed = false;
    const ctx = vm.createContext({ isSpinning: true, rouletteEditRequested: false, editingMissionsType: '',
        currentMissionsType: 'team', teamMissions: [{ text: '팀 미션' }], individualMissions: [], editMissionsTemp: [],
        document: { getElementById: id => id === 'rouletteEditModal' ? modal : summary },
        window: { closeRouletteModal(force) { closed = force; }, renderRouletteEditList() {} }
    });
    vm.runInContext(section('window.openRouletteEditModal = function', 'window.closeRouletteEditModal = function'), ctx);
    ctx.window.openRouletteEditModal();
    assert.equal(ctx.rouletteEditRequested, true);
    assert.equal(modal.style.display, undefined);
    ctx.isSpinning = false;
    ctx.window.openRouletteEditModal();
    assert.equal(closed, true);
    assert.equal(modal.style.display, 'flex');
    assert.equal(ctx.editingMissionsType, 'team');
    ctx.editMissionsTemp[0].text = '수정';
    assert.equal(ctx.teamMissions[0].text, '팀 미션');
});

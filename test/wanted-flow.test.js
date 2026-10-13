import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function makeClassList(initial = []) {
    const values = new Set(initial);
    return {
        add: (name) => values.add(name),
        remove: (name) => values.delete(name),
        contains: (name) => values.has(name)
    };
}

test('closing a winning wanted roulette reveals exactly one participant after the suspense', async () => {
    const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    const revealStart = source.indexOf('let wantedRevealInterval = null;');
    const revealEnd = source.indexOf('window.toggleWantedEffect = function', revealStart);
    const closeStart = source.indexOf('window.closeRouletteModal = function');
    const closeEnd = source.indexOf('window.openTimerFromRoulette = function', closeStart);
    assert.ok(revealStart >= 0 && revealEnd > revealStart && closeStart >= 0 && closeEnd > closeStart);

    const cards = ['민수', '지아'].map((studentName) => ({
        classList: makeClassList(),
        attributes: {},
        querySelector: () => ({ textContent: studentName }),
        setAttribute(name, value) { this.attributes[name] = value; }
    }));
    const overlay = { classList: makeClassList(['hidden']) };
    const label = { textContent: '' };
    const name = { textContent: '' };
    const roulette = { style: { display: 'flex' } };
    const draw = { style: { display: 'flex' } };
    const summary = { classList: makeClassList(['roulette-winning']) };
    const nodes = {
        'wanted-reveal-overlay': overlay,
        'wanted-reveal-label': label,
        'wanted-reveal-name': name,
        rouletteModal: roulette,
        gagaDrawModal: draw,
        'roulette-result-summary': summary
    };
    const timeouts = new Map();
    const intervals = new Map();
    let nextTimerId = 10;
    let stampSounds = 0;
    const context = {
        document: {
            getElementById: (id) => nodes[id],
            querySelectorAll: () => cards
        },
        getComputedStyle: (node) => ({ display: node.style.display }),
        Math: { random: () => 0.8, floor: Math.floor },
        setTimeout(fn, delay) { const id = nextTimerId++; timeouts.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timeouts.delete(id); },
        setInterval(fn, delay) { const id = nextTimerId++; intervals.set(id, { fn, delay }); return id; },
        clearInterval(id) { intervals.delete(id); },
        syncBackgroundMusic() {},
        window: {
            showFloatingRouletteBtn() {},
            playStampSound() { stampSounds++; }
        }
    };
    vm.createContext(context);
    vm.runInContext(`let rouletteStartTimer = null;
        let rouletteAutoCloseTimer = 1;
        let pendingWantedReveal = true;
        let isSpinning = false;
        ${source.slice(revealStart, revealEnd)}
        ${source.slice(closeStart, closeEnd)}`, context);

    context.window.closeRouletteModal(true);
    assert.equal(roulette.style.display, 'none');
    assert.equal(overlay.classList.contains('hidden'), false);
    assert.equal(cards.filter(card => card.classList.contains('wanted-active')).length, 0);

    const suspense = [...timeouts.values()].find(timer => timer.delay === 1800);
    assert.ok(suspense);
    suspense.fn();
    const finish = [...timeouts.values()].find(timer => timer.delay === 650);
    assert.ok(finish);
    finish.fn();

    assert.equal(overlay.classList.contains('hidden'), true);
    assert.equal(cards.filter(card => card.classList.contains('wanted-active')).length, 1);
    assert.equal(cards[1].attributes['aria-pressed'], 'true');
    assert.equal(stampSounds, 1);
});

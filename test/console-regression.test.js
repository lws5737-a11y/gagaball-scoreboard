import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { mergeSchoolState } from '../state-sync.js';
import { getTeamRefereePlan, getRefereeEligibleTeams } from '../app-utils.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function section(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
}
const school = () => ({ data: { A: [{ no: 1, name: '학생', gender: '남', score: 4, attendance: true }] },
    scores: {}, records: {}, stamps: {}, hiddenClasses: [], stampImage: '', rouletteMissions: { individual: [], team: [] } });

test('editing loaded data never mutates the acknowledged cloud snapshot', () => {
    const saved = school();
    const ctx = vm.createContext({ structuredClone, currentGagaTeams: [], currentClass: 'A', isSpinning: false,
        currentMissionsType: 'individual', classData: {}, groupScores: {}, groupRecords: {}, classStamps: {},
        hiddenClasses: [], globalStampImage: '', individualMissions: [], teamMissions: [], currentMissions: [] });
    vm.runInContext(section('function applySchool(', 'function refreshSchoolViews('), ctx);
    ctx.applySchool(saved);
    ctx.classData.A[0].score++;
    ctx.classData.A[0].gagaDrawn = true;
    assert.equal(saved.data.A[0].score, 4);
    assert.equal(saved.data.A[0].gagaDrawn, undefined);
    assert.equal(mergeSchoolState(saved, { ...school(), data: ctx.classData }, saved).data.A[0].score, 5);
});

test('ambiguous save failure can retry the same receipt without doubling the score', async () => {
    let cloud = school(), live = school(), failAfterCommit = true, writes = 0;
    live.data.A[0].score++;
    const ctx = vm.createContext({ structuredClone, crypto: { randomUUID }, console: { error() {} },
        userId: 'teacher', db: {}, savedSchool: school(), saveRequested: true, saveInFlight: false,
        pendingCommit: null, writerId: 'one-tab', saveTimer: null, syncError: '',
        doc: () => 'school', schoolState: () => structuredClone(live), readSchool: value => {
            const { saveReceipts, ...data } = value || school(); return data;
        }, mergeSchoolState, applySchool: value => { live = structuredClone(value); },
        keepDraft() {}, refreshSchoolViews() {}, setSyncStatus() {}, draftKey: () => 'draft',
        localStorage: { removeItem() {} }, clearTimeout() {}, setTimeout() {},
        runTransaction: async (_, fn) => {
            const result = await fn({ get: async () => ({ exists: () => true, data: () => structuredClone(cloud) }),
                update: (_, data) => { cloud = { ...cloud, ...structuredClone(data) }; writes++; } });
            if (failAfterCommit) { failAfterCommit = false; throw new Error('Response lost after commit'); }
            return result;
        } });
    vm.runInContext(section('async function flushSaveData()', "window.addEventListener('online'"), ctx);
    await ctx.flushSaveData();
    assert.equal(cloud.data.A[0].score, 5);
    assert.equal(ctx.saveRequested, true);
    assert.ok(ctx.pendingCommit);
    await ctx.flushSaveData();
    assert.equal(cloud.data.A[0].score, 5);
    assert.equal(live.data.A[0].score, 5);
    assert.equal(writes, 1);
    assert.equal(ctx.pendingCommit, null);
    assert.equal(ctx.saveRequested, false);
});

test('team scores start at zero and include students without a gender value', () => {
    const students = Array.from({ length: 9 }, (_, i) => ({ no: i + 1, score: i + 1,
        gender: ['남', '여', '-'][i % 3], isReferee: i < 3 }));
    const ctx = vm.createContext({ getTeamRefereePlan, getRefereeEligibleTeams,
        currentGagaTeams: [], currentGagaStandbyReferees: [], currentGagaRefereeWarning: false,
        refereeRotation: { teams: {} }, assignMatchReferee: () => null,
        teamMissionResults: {}, syncBackgroundMusic() {}, alert: message => assert.fail(message),
        window: { closeGagaTimer() {}, closeGagaDrawModal() {}, renderGagaTeamView() {}, fireConfetti() {} } });
    vm.runInContext(section('const getStudentPower =', 'let currentGagaTeams ='), ctx);
    vm.runInContext(section('window.executeGagaTeams =', 'window.toggleTeamKing ='), ctx);
    ctx.window.executeGagaTeams(4, students);
    assert.equal(new Set(ctx.currentGagaTeams.flatMap(t => t.members.map(s => s.no))).size, 9);
    assert.ok(ctx.currentGagaTeams.every(t => t.score === 0));
    assert.ok(ctx.currentGagaTeams.every(t => t.members.length <= t.targetSize));
    for (let i = 0; i < 4; i += 2) assert.ok(ctx.currentGagaTeams.slice(i, i + 2).flatMap(t => t.members).filter(s => s.isReferee).length < 3);
    ctx.currentGagaTeams[0].members[0].score = 999;
    assert.ok(students.every(s => s.score < 999));
});

test('subtracting from a zero team score cannot subtract personal points', () => {
    const ctx = vm.createContext({ currentClass: 'A', classData: school().data,
        currentGagaTeams: [{ id: 1, score: 0, members: [{ no: 1, score: 4 }] }], saveData() {},
        window: { playCoinSound() {}, playBumpSound() {}, renderGagaTeamView() {}, renderGagaball() {}, renderGagaRanking() {} } });
    vm.runInContext(section('window.addGagaTeamScore =', 'window.openTimerSelectModal ='), ctx);
    ctx.window.addGagaTeamScore(1, -1);
    assert.equal(ctx.classData.A[0].score, 4);
    ctx.window.addGagaTeamScore(1, 1);
    assert.equal(ctx.classData.A[0].score, 5);
    ctx.window.addGagaTeamScore(1, -1);
    assert.equal(ctx.classData.A[0].score, 4);
});

test('keyboard activation of a score button does not toggle the wanted card', () => {
    let prevented = false, toggled = false;
    const ctx = vm.createContext({ window: { toggleWantedEffect() { toggled = true; } } });
    vm.runInContext(section('window.handleWantedEffectKey =', 'window.startChampionsTournament ='), ctx);
    ctx.window.handleWantedEffectKey({ key: ' ', target: {}, currentTarget: {}, preventDefault() { prevented = true; } });
    assert.equal(prevented, false); assert.equal(toggled, false);
});

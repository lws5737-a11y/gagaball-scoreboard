// Pure merge logic shared by cloud saves, draft recovery and tests.
import { validateMissions } from './app-utils.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => value === undefined ? undefined : structuredClone(value);
export class SyncConflict extends Error {
    constructor(path) { super(`다른 기기에서 같은 항목을 변경했습니다: ${path.join(' / ')}`); this.name = 'SyncConflict'; }
}
function keyed(state) {
    const result = clone(state);
    result.data = Object.fromEntries(Object.entries(result.data || {}).map(([name, students]) =>
        [name, Object.fromEntries(students.map(student => [String(student.no), student]))]));
    return result;
}
function unkeyed(state) {
    state.data = Object.fromEntries(Object.entries(state.data || {}).map(([name, students]) =>
        [name, Object.values(students).sort((a, b) => a.no - b.no)]));
    return state;
}
function merge(base, local, remote, path) {
    if (same(base, local)) return clone(remote);
    if (same(base, remote)) return clone(local);
    if (path.length === 4 && path[0] === 'data' && path[3] === 'score'
        && [base, local, remote].every(Number.isFinite)) return Math.max(0, remote + local - base);
    if (object(base) && object(local) && object(remote)) {
        const result = {};
        for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('잘못된 데이터 키');
            const value = merge(base[key], local[key], remote[key], [...path, key]);
            if (value !== undefined) result[key] = value;
        }
        return result;
    }
    if (same(local, remote)) return clone(remote);
    throw new SyncConflict(path);
}
export function mergeSchoolState(base, local, remote) {
    return unkeyed(merge(keyed(base), keyed(local), keyed(remote), []));
}
export function validateBackup(value) {
    if (!value || value.version !== 1 || !object(value.school?.data)) throw new Error('가가볼 백업 파일이 아닙니다.');
    for (const key of ['scores', 'records', 'stamps']) {
        if (value.school[key] !== undefined && !object(value.school[key])) throw new Error(`${key} 백업 형식 오류`);
    }
    if (value.school.hiddenClasses !== undefined && (!Array.isArray(value.school.hiddenClasses) || value.school.hiddenClasses.some(name => typeof name !== 'string'))) throw new Error('숨김 학급 형식 오류');
    if (Object.values(value.school.stamps || {}).some(stamps => !Array.isArray(stamps) || stamps.some(stamp => typeof stamp !== 'boolean'))) throw new Error('도장판 형식 오류');
    if (value.school.rouletteMissions !== undefined) {
        if (!object(value.school.rouletteMissions)) throw new Error('미션 백업 형식 오류');
        for (const missions of Object.values(value.school.rouletteMissions)) if (!Array.isArray(missions) || !validateMissions(missions).valid) throw new Error('미션 백업 형식 오류');
    }
    for (const [name, students] of Object.entries(value.school.data)) {
        if (['__proto__', 'constructor', 'prototype'].includes(name) || !Array.isArray(students)) throw new Error('학급 데이터 형식 오류');
        const seen = new Set();
        for (const s of students) {
            if (!s || !Number.isInteger(s.no) || s.no < 1 || seen.has(s.no) || typeof s.name !== 'string' || !s.name.trim()
                || !Number.isFinite(s.score) || s.score < 0 || !['남', '여', '-'].includes(s.gender)) throw new Error(`${name} 학생 데이터 형식 오류`);
            seen.add(s.no);
        }
        if (['남', '여'].some(gender => students.filter(s => s.gender === gender).length > 50)) throw new Error(`${name}: 남학생·여학생은 각각 최대 50명입니다.`);
    }
    return clone(value.school);
}
export function timerPosition(timer, now = Date.now()) {
    if (!timer) return 0;
    return Math.min(timer.duration + 3, Math.max(0, timer.position + (timer.running ? (now - timer.startedAt) / 1000 : 0)));
}
export function roomConnectionStatus(room, role, now = Date.now()) {
    if (!room) return { connected: false, acknowledged: false };
    const heartbeat = role === 'controller' ? room.tvAlive : room.controllerAlive;
    const connected = Number.isFinite(heartbeat) && heartbeat > 0 && now - heartbeat < 30000;
    return { connected, acknowledged: connected && role === 'controller' && room.seq > 0 && room.tvSeenSeq >= room.seq };
}
// A closed tab must not occupy a room slot for the full four-hour code lifetime.
// Keep either endpoint's recent heartbeat, and always preserve the caller's room.
export function pruneTVRooms(rooms = {}, { now = Date.now(), keepCode = '', owner = '', clearWaiting = false } = {}) {
    return Object.fromEntries(Object.entries(rooms).filter(([code, room]) => {
        if (code === keepCode) return true;
        if (!room || !Number.isFinite(room.expiresAt) || room.expiresAt <= now) return false;
        const tvAlive = Number(room.tvAlive) || 0, controllerAlive = Number(room.controllerAlive) || 0;
        if (now - Math.max(tvAlive, controllerAlive) >= 120000) return false;
        if (clearWaiting && owner && room.owner === owner && (!room.controller || now - controllerAlive >= 120000)) return false;
        return true;
    }));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../console.js', import.meta.url), 'utf8');
const start = source.indexOf('    function listen()');
const end = source.indexOf('    function applyReceivedState()', start);
assert.ok(start >= 0 && end > start);
function setup() {
    const callbacks = [];
    let disconnected = 0, applied = 0;
    const ctx = vm.createContext({
        unsubscribe: null, lastApplied: -1, connectionVersion: 0,
        roomCode: 'NEWCODE2', room: null, role: 'tv', client: 'device', message: '', window: {},
        api: { schoolRef: () => 'school', get: () => ({ userId: 'teacher' }) },
        onSnapshot(ref, options, callback) { assert.equal(options.includeMetadataChanges, true); callbacks.push(callback); return () => {}; },
        disconnect() { disconnected++; ctx.connectionVersion++; ctx.roomCode = ''; },
        applyReceivedState() { applied++; }, render() {}
    });
    vm.runInContext(source.slice(start, end), ctx);
    const snapshot = (rooms, metadata = {}) => ({ metadata: { hasPendingWrites: false, fromCache: false, ...metadata }, data: () => ({ gagaRooms: rooms }) });
    return { ctx, callbacks, snapshot, disconnected: () => disconnected, applied: () => applied };
}
test('a stale cache event without the newly created code must not disconnect the TV', () => {
    const env = setup(); env.ctx.listen();
    env.callbacks[0](env.snapshot({}, { fromCache: true }));
    assert.equal(env.disconnected(), 0);
    assert.equal(env.ctx.roomCode, 'NEWCODE2');
    env.callbacks[0](env.snapshot({ NEWCODE2: { owner: 'teacher', expiresAt: Date.now() + 60000 } }));
    assert.equal(env.disconnected(), 0);
    assert.equal(env.applied(), 1);
});
test('callbacks from the previous code cannot terminate a replacement connection', () => {
    const env = setup(); env.ctx.listen();
    env.ctx.roomCode = 'NEWCODE3'; env.ctx.listen();
    env.callbacks[0](env.snapshot({}));
    assert.equal(env.disconnected(), 0);
    assert.equal(env.ctx.roomCode, 'NEWCODE3');
});
test('a server-confirmed missing code still ends the connection', () => {
    const env = setup(); env.ctx.listen();
    env.callbacks[0](env.snapshot({}));
    assert.equal(env.disconnected(), 1);
});

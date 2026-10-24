import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../console.js', import.meta.url), 'utf8');
test('every random byte produces a character in an eight-character pairing code', () => {
    const begin = source.indexOf("            const alphabet=");
    const finish = source.indexOf('            const now=', begin);
    assert.ok(begin >= 0 && finish > begin);
    for (let byte = 0; byte < 256; byte++) {
        const ctx = vm.createContext({ roomCode: '', crypto: { getRandomValues: array => array.fill(byte) } });
        vm.runInContext(source.slice(begin, finish), ctx);
        assert.match(ctx.roomCode, /^[A-Z2-9]{8}$/);
    }
});
const start = source.indexOf('    function listen()');
const end = source.indexOf('    function applyReceivedState()', start);
assert.ok(start >= 0 && end > start);
function setup() {
    const callbacks = [];
    const reads = [];
    let disconnected = 0, applied = 0;
    const ctx = vm.createContext({
        unsubscribe: null, lastApplied: -1, connectionVersion: 0,
        roomCode: 'NEWCODE2', room: null, role: 'tv', client: 'device', message: '', window: {},
        api: { schoolRef: () => 'school', get: () => ({ userId: 'teacher' }) },
        onSnapshot(ref, options, callback) { assert.equal(options.includeMetadataChanges, true); callbacks.push(callback); return () => {}; },
        getDocFromServer() { return new Promise((resolve, reject) => reads.push({ resolve, reject })); },
        disconnect() { disconnected++; ctx.connectionVersion++; ctx.roomCode = ''; },
        applyReceivedState() { applied++; }, render() {}
    });
    vm.runInContext(source.slice(start, end), ctx);
    const snapshot = (rooms, metadata = {}) => ({ metadata: { hasPendingWrites: false, fromCache: false, ...metadata }, data: () => ({ gagaRooms: rooms }) });
    return { ctx, callbacks, reads, snapshot, disconnected: () => disconnected, applied: () => applied };
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
test('a fresh server read confirming a missing code ends the connection', async () => {
    const env = setup(); env.ctx.listen();
    env.callbacks[0](env.snapshot({}));
    assert.equal(env.disconnected(), 0);
    env.reads[0].resolve(env.snapshot({}));
    await new Promise(setImmediate);
    assert.equal(env.disconnected(), 1);
});

test('an existing server watch can lag behind the successful create transaction', async () => {
    const env = setup(); env.ctx.listen();
    env.callbacks[0](env.snapshot({})); // fromCache:false, but predates creation
    env.reads[0].resolve(env.snapshot({ NEWCODE2: { owner: 'teacher', expiresAt: Date.now() + 60000 } }));
    await new Promise(setImmediate);
    assert.equal(env.disconnected(), 0);
    assert.equal(env.ctx.roomCode, 'NEWCODE2');
    assert.equal(env.applied(), 1);
});

test('a delayed server check cannot override a newer valid watch event', async () => {
    const env = setup(); env.ctx.listen();
    env.callbacks[0](env.snapshot({}));
    env.callbacks[0](env.snapshot({ NEWCODE2: { owner: 'teacher', expiresAt: Date.now() + 60000 } }));
    env.reads[0].resolve(env.snapshot({}));
    await new Promise(setImmediate);
    assert.equal(env.disconnected(), 0);
    assert.equal(env.applied(), 1);
});

test('a failed server check preserves the code for reconnection', async () => {
    const env = setup(); env.ctx.listen();
    env.callbacks[0](env.snapshot({}));
    env.reads[0].reject(new Error('offline'));
    await new Promise(setImmediate);
    assert.equal(env.disconnected(), 0);
    assert.equal(env.ctx.roomCode, 'NEWCODE2');
    assert.match(env.ctx.message, /연결 확인 대기/);
});

test('a stale controller identity after joining is checked against the server', async () => {
    const env = setup(); env.ctx.role = 'controller'; env.ctx.listen();
    const room = { owner: 'teacher', expiresAt: Date.now() + 60000, controller: '' };
    env.callbacks[0](env.snapshot({ NEWCODE2: room }));
    env.reads[0].resolve(env.snapshot({ NEWCODE2: { ...room, controller: 'device' } }));
    await new Promise(setImmediate);
    assert.equal(env.disconnected(), 0);
    assert.equal(env.applied(), 1);
});

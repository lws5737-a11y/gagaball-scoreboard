import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../console.js', import.meta.url), 'utf8');
test('connection verification bypasses stale watch state with a transaction read', async () => {
    const current = { data: () => ({ gagaRooms: { NEWCODE2: {} } }) };
    const ctx = vm.createContext({
        api: { db: 'database', schoolRef: () => 'school' },
        runTransaction: async (db, fn) => { assert.equal(db, 'database'); return fn({ get: async ref => { assert.equal(ref, 'school'); return current; } }); },
        getDocFromServer: () => { throw new Error('must not reuse the watch'); }
    });
    vm.runInContext(source.slice(source.indexOf('    function readConnectionDocument()'), source.indexOf('    async function cleanupRooms()')), ctx);
    assert.equal(await ctx.readConnectionDocument(), current);
});
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
        unsubscribe: null, lastApplied: -1, connectionVersion: 0, verifiedCreation: true,
        roomCode: 'NEWCODE2', room: null, role: 'tv', client: 'device', message: '', window: {},
        api: { schoolRef: () => 'school', get: () => ({ userId: 'teacher' }) },
        onSnapshot(ref, options, callback) { assert.equal(options.includeMetadataChanges, true); callbacks.push(callback); return () => {}; },
        readConnectionDocument() { return new Promise((resolve, reject) => reads.push({ resolve, reject })); },
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
    assert.match(env.ctx.message, /ROOM_MISSING/);
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

test('a confirmed controller replacement still disconnects the previous device', async () => {
    const env = setup(); env.ctx.role = 'controller'; env.ctx.listen();
    const changed = env.snapshot({ NEWCODE2: { owner: 'teacher', expiresAt: Date.now()+60000, controller: 'other-device' } });
    env.callbacks[0](changed); env.reads[0].resolve(changed);
    await new Promise(setImmediate);
    assert.equal(env.disconnected(), 1);
});

for (const [reason, alter] of [
    ['CREATE_MISSING', () => undefined],
    ['CREATE_OWNER', room => ({ ...room, owner: 'other' })],
    ['CREATE_DEVICE', room => ({ ...room, tv: 'other' })],
    ['CREATE_EXPIRY', room => ({ ...room, expiresAt: 0 })],
    ['', room => room]
]) test(`host verifies actual persisted room before displaying success: ${reason || 'success'}`, async () => {
    let stored, listened = 0;
    const ctx = vm.createContext({
        creatingRoom: false, verifiedCreation: false, message: '', roomCode: '', room: null, role: '', client: 'device',
        crypto: { getRandomValues: array => array.fill(0) },
        api: { schoolRef: () => 'school', get: () => ({ userId: 'teacher' }), unlock() {} },
        editRoom: async fn => { stored = fn(undefined, 'teacher'); return stored; },
        readConnectionDocument: async () => ({ data: () => ({ gagaRooms: { [ctx.roomCode]: alter(stored) } }) }),
        render() {}, rememberConnection() {}, setMode() {}, queuePublish() {}, listen() { listened++; }
    });
    vm.runInContext(source.slice(source.indexOf('    async function host()'), source.indexOf('    async function join()')), ctx);
    if(reason) {
        await assert.rejects(ctx.host(), new RegExp(reason));
        assert.equal(ctx.roomCode, ''); assert.equal(listened, 0);
    } else {
        await ctx.host(); assert.equal(ctx.verifiedCreation, true); assert.equal(listened, 1);
    }
    assert.equal(ctx.creatingRoom, false);
});

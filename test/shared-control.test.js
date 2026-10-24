import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../console.js', import.meta.url), 'utf8');
function setup(role) {
    let restores = 0, writes = 0;
    const state = { className: 'A', view: 'team' };
    const ctx = vm.createContext({
        role, client: role, roomCode: 'CODE2222', window: {}, lastApplied: 0,
        pendingRestore: null, restoringConnection: false, sending: false, queuedState: null,
        focusedMatch: 0, publishTimer: null, message: '',
        room: { owner: 'teacher', tv: 'tv', controller: 'controller', seq: 1, writer: 'peer', state, expiresAt: Date.now()+60000 },
        api: { get: () => ({ userId: 'teacher', classes: ['A'], match: state }), restoreMatch() { restores++; ctx.queuePublish(); ctx.applyReceivedState(); } },
        focusTV() {}, render() {}, clearTimeout() {}, setTimeout() {},
        editRoom: async fn => { writes++; return fn(ctx.room); }
    });
    vm.runInContext(source.slice(source.indexOf('    function applyReceivedState()'), source.indexOf('    async function host()')) +
        source.slice(source.indexOf('    function queuePublish()'), source.indexOf('    function focusTV(')), ctx);
    return {ctx, restores:()=>restores, writes:()=>writes};
}
for(const role of ['tv','controller']) {
    test(`${role} applies peer state without publishing an echo or recursive restore`,()=>{
        const e=setup(role);e.ctx.applyReceivedState();
        assert.equal(e.restores(),1);assert.equal(e.ctx.queuedState,null);assert.equal(e.ctx.lastApplied,1);
    });
    test(`${role} can publish local changes and keeps its committed state`,async()=>{
        const e=setup(role);e.ctx.queuePublish();await e.ctx.publish();
        assert.equal(e.writes(),1);assert.equal(e.ctx.lastApplied,2);assert.equal(e.restores(),0);
    });
    test(`${role} cannot publish using a replaced device identity`,async()=>{
        const e=setup(role);e.ctx.room[role==='tv'?'tv':'controller']='someone-else';
        e.ctx.queuePublish();await e.ctx.publish();
        assert.match(e.ctx.message,/제어 연결이 해제/);assert.equal(e.ctx.lastApplied,0);
    });
}
test('local pending changes are not replaced by an incoming snapshot',()=>{
    const e=setup('tv');e.ctx.queuePublish();e.ctx.applyReceivedState();assert.equal(e.restores(),0);
});
test('a device does not replay its own published animation',()=>{
    const e=setup('controller');e.ctx.room.writer='controller';e.ctx.applyReceivedState();
    assert.equal(e.restores(),0);assert.equal(e.ctx.lastApplied,1);
});

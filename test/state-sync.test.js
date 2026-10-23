import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSchoolState,SyncConflict,timerPosition,validateBackup,roomConnectionStatus} from '../state-sync.js';
const state=()=>({data:{A:[{no:1,name:'가',gender:'남',score:0},{no:2,name:'나',gender:'여',score:0}],B:[{no:1,name:'다',gender:'-',score:0}]},scores:{},records:{},stamps:{},hiddenClasses:[]});
test('concurrent student score changes merge, including two teachers incrementing the same score',()=>{
    const base=state(),a=state(),b=state();a.data.A[0].score=1;b.data.A[0].score=1;b.data.A[1].score=2;
    const merged=mergeSchoolState(base,a,b);assert.deepEqual(merged.data.A.map(s=>s.score),[2,2]);
});
test('pending clicks rebase onto a committed snapshot without losing the second click',()=>{
    const sent=state(),live=state(),committed=state();sent.data.A[0].score=1;live.data.A[0].score=2;committed.data.A[0].score=1;committed.data.B[0].score=4;
    const merged=mergeSchoolState(sent,live,committed);assert.equal(merged.data.A[0].score,2);assert.equal(merged.data.B[0].score,4);
});
test('class deletion persists while another class update survives',()=>{
    const base=state(),local=state(),remote=state();delete local.data.A;remote.data.B[0].score=5;
    const merged=mergeSchoolState(base,local,remote);assert.equal(merged.data.A,undefined);assert.equal(merged.data.B[0].score,5);
});
test('conflicting roster changes are rejected without silently overwriting',()=>{
    const base=state(),a=state(),b=state();a.data.A[0].name='수정1';b.data.A[0].name='수정2';assert.throws(()=>mergeSchoolState(base,a,b),SyncConflict);
});
test('timer computes common elapsed time and preserves paused position',()=>{
    const timer={duration:60,position:8,startedAt:1000,running:true};assert.equal(timerPosition(timer,4000),11);assert.equal(timerPosition({...timer,running:false},9000),8);assert.equal(timerPosition(timer,999999),63);
});
test('backup validation rejects duplicate student numbers and invalid scores',()=>{
    const school=state();assert.deepEqual(validateBackup({version:1,school}),school);school.data.A[1].no=1;assert.throws(()=>validateBackup({version:1,school}));
});
test('connection status is safe before the asynchronous room restore finishes',()=>{
    assert.deepEqual(roomConnectionStatus(null,'controller'),{connected:false,acknowledged:false});
    const room={tvAlive:1000,controllerAlive:1000,seq:2,tvSeenSeq:2};
    assert.deepEqual(roomConnectionStatus(room,'controller',2000),{connected:true,acknowledged:true});
    assert.deepEqual(roomConnectionStatus(room,'controller',40000),{connected:false,acknowledged:false});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { timerPosition } from '../state-sync.js';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('        if (state.timer) {', source.indexOf('function restoreMatch('));
const block = source.slice(start, source.indexOf('        if (Number.isFinite(state.volume))', start));
function setup(fresh = true) {
    let resolvePlay;
    const audio = {currentTime:0, paused:true, play(){this.paused=false;return new Promise(resolve=>{resolvePlay=resolve;});}, pause(){this.paused=true;}};
    const ctx = vm.createContext({state:{timer:{id:'remote',duration:60,position:0,startedAt:Date.now()-1800,running:true}},
        timerModel:null,pendingRemoteTimerStart:null,activeTimerAudio:audio,pause:false,structuredClone,timerPosition,
        window:{gagaFreshRemoteState:fresh,gagaRemoteMuted:false,openGagaTimer(){},closeGagaTimer(){}},
        document:{getElementById:()=>({textContent:''})},timerAnimationFrame:null,renderTimerScreen(){},published:0,persistMatch(){ctx.published++;}});
    return {ctx,audio,ready:async()=>{resolvePlay();await Promise.resolve();}};
}
test('fresh remote timer waits for audio and preserves its first signal despite network delay',async()=>{
    const {ctx,audio,ready}=setup();
    vm.runInContext(block,ctx);
    assert.equal(audio.currentTime,0);
    assert.equal(ctx.timerModel.running,false);
    vm.runInContext(block,ctx); // repeated packet while audio is loading
    assert.equal(audio.currentTime,0);
    await ready();
    assert.equal(ctx.timerModel.running,true);
    assert.ok(timerPosition(ctx.timerModel)<.1);
    assert.equal(ctx.published,1);
});
test('reconnection resumes elapsed timer instead of replaying the intro',()=>{
    const {ctx,audio}=setup(false);
    vm.runInContext(block,ctx);
    assert.ok(audio.currentTime>=1.8);
    assert.equal(ctx.pendingRemoteTimerStart,null);
});
test('late audio readiness cannot reopen a closed timer',async()=>{
    const {ctx,ready}=setup();vm.runInContext(block,ctx);
    ctx.timerModel=null;ctx.pendingRemoteTimerStart=null;
    await ready();assert.equal(ctx.published,0);assert.equal(ctx.timerModel,null);
});

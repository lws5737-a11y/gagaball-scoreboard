import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { roomConnectionStatus } from '../state-sync.js';
const source = await readFile(new URL('../console.js', import.meta.url), 'utf8');
const section = (a,b) => source.slice(source.indexOf(a), source.indexOf(b,source.indexOf(a)));
test('remote controls require online, live, owned and fully restored connection', () => {
    const ctx=vm.createContext({mode:'remote',navigator:{onLine:true},restoringConnection:false,role:'controller',client:'phone',roomConnectionStatus,
        room:{controller:'phone',tvAlive:Date.now(),expiresAt:Date.now()+60000}});
    vm.runInContext(section('    function controlError()', '    window.gagaCanControl'),ctx);
    assert.equal(ctx.controlError(),'');
    for(const update of [{navigator:{onLine:false}},{restoringConnection:true},{role:'tv'},{room:{controller:'other',tvAlive:Date.now(),expiresAt:Date.now()+60000}},{room:{controller:'phone',tvAlive:Date.now()-31000,expiresAt:Date.now()+60000}}]) {
        const previous={...ctx};Object.assign(ctx,update);assert.notEqual(ctx.controlError(),'');Object.assign(ctx,previous);
    }
});
for(const role of ['tv','controller']) test(`${role} refresh restores server match even if its own device last wrote it`,async()=>{
    let restored=0;
    const saved={uid:'teacher',role,roomCode:'ABCD'};
    const ctx=vm.createContext({resuming:false,navigator:{onLine:true},sessionStorage:{getItem:()=>JSON.stringify(saved)},
        api:{get:()=>({userId:'teacher'})},client:'device',roomCode:'',role:'',room:null,restoringConnection:false,pendingRestore:null,
        editRoom:async fn=>fn({owner:'teacher',expiresAt:Date.now()+60000,tv:'device',controller:'device',state:{className:'A',timer:{running:true}}}),
        setMode(){},applyReceivedState(){restored++;assert.equal(ctx.pendingRestore.timer.running,true);ctx.restoringConnection=false;},listen(){},render(){},queuePublish(){assert.fail('must restore before publishing');},message:'',disconnect(){assert.fail('valid refresh must not disconnect');}});
    vm.runInContext(section('    async function resumeConnection()', '    async function action('),ctx);
    await ctx.resumeConnection();assert.equal(restored,1);assert.equal(ctx.resuming,false);
});
test('offline refresh retains saved pairing for later reconnect',async()=>{
    const ctx=vm.createContext({resuming:false,navigator:{onLine:false},sessionStorage:{getItem(){assert.fail('do not attempt network restoration offline');}}});
    vm.runInContext(section('    async function resumeConnection()', '    async function action('),ctx);
    await ctx.resumeConnection();assert.equal(ctx.resuming,false);
});

test('reloading the roulette owner closes the orphaned animation and publishes recovery',async()=>{
    let published=0;
    const ctx=vm.createContext({resuming:false,navigator:{onLine:true},sessionStorage:{getItem:()=>JSON.stringify({uid:'teacher',role:'controller',roomCode:'ABCD'})},
        api:{get:()=>({userId:'teacher'})},client:'phone',roomCode:'',role:'',room:null,restoringConnection:false,pendingRestore:null,
        editRoom:async fn=>fn({owner:'teacher',controller:'phone',expiresAt:Date.now()+60000,writer:'phone',state:{className:'A',roulette:{open:true,spinning:true}}}),
        setMode(){},applyReceivedState(){assert.equal(ctx.pendingRestore.roulette.open,false);assert.equal(ctx.pendingRestore.roulette.spinning,false);ctx.restoringConnection=false;},
        listen(){},render(){},queuePublish(){published++;},message:'',disconnect(){assert.fail('do not disconnect');}});
    vm.runInContext(section('    async function resumeConnection()', '    async function action('),ctx);
    await ctx.resumeConnection();assert.equal(published,1);assert.match(ctx.message,/중단된 룰렛/);
});

test('temporary server failure retains pairing and permits a later restore retry',async()=>{
    const ctx=vm.createContext({resuming:false,navigator:{onLine:true},sessionStorage:{getItem:()=>JSON.stringify({uid:'teacher',role:'tv',roomCode:'ABCD'})},
        api:{get:()=>({userId:'teacher'})},client:'tv',roomCode:'',role:'',restoringConnection:false,
        editRoom:async()=>{throw Object.assign(new Error('unavailable'),{code:'unavailable'});},render(){},message:'',disconnect(){assert.fail('must preserve session');}});
    vm.runInContext(section('    async function resumeConnection()', '    async function action('),ctx);
    await ctx.resumeConnection();assert.equal(ctx.roomCode,'ABCD');assert.equal(ctx.restoringConnection,true);assert.equal(ctx.resuming,false);
});

test('receiving device rejects a second roulette while peer animation is active',async()=>{
    const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
    const ctx=vm.createContext({window:{gagaRemoteRouletteBusy:true}});
    vm.runInContext(app.slice(app.indexOf('window.openRouletteModal ='),app.indexOf('window.closeRouletteModal =')),ctx);
    assert.equal(ctx.window.openRouletteModal('individual'),false);
});

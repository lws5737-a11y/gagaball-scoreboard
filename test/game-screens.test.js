import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { nextTeamScroll } from '../game-screens.js';
import { escapeHTML, toggleTeamKingSelection, getMatchReferees } from '../app-utils.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function setup(index = -1) {
    const nodes = new Map();
    const node = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML:'', classList:{toggle(){},add(){}}, scrollIntoView(){} }); return nodes.get(id); };
    const ctx = vm.createContext({ currentTeamMatchIndex:index, currentGagaTeams:Array.from({length:4},(_,i)=>({id:i+1,members:[{no:i+1,name:`학생${i+1}`,gender:'남',score:3,isKing:true}]})),
        currentGagaStandbyReferees:[],currentGagaRefereeWarning:false,teamMissionResults:{'team-roulette-0':{text:'왕을 잡아라'}},
        escapeHTML, fallbackSVG:'', missionMarkup:r=>r.text, toggleTeamKingSelection, getMatchReferees,
        currentClass:'A', classData:{A:[{no:9,name:'심판9',attendance:true,isReferee:true}]}, refereeRotation:{teams:{0:9,1:9}},
        document:{getElementById:node}, window:{generateCuteAvatar:()=>'',playCoinSound(){},playBumpSound(){},fireConfetti(){}},
        isSpinning:false,rouletteAutoCloseTimer:null,currentDrawIsChampions:true,persistMatch(){},syncBackgroundMusic(){} });
    vm.runInContext(section('function matchRefereeMarkup(', 'function refreshSchoolViews('),ctx);
    vm.runInContext(section('window.renderGagaTeamView = function', 'window.addGagaTeamScore = function'),ctx);
    vm.runInContext(section('window.toggleTeamKing = function', 'window.renderGagaTeamView = function'),ctx);
    return {ctx,node};
}
test('team overview contains all teams without roulette or king selection',()=>{
    const {ctx,node}=setup();ctx.window.renderGagaTeamView();
    for(const name of ['학생1','학생2','학생3','학생4'])assert.ok(node('gaga-team-matchups').innerHTML.includes(name));
    assert.doesNotMatch(node('gaga-team-matchups').innerHTML,/matchup-roulette-button|king-select-button|team-king-effect/);
    ctx.window.toggleTeamKing(1,1);assert.equal(ctx.currentGagaTeams[0].members[0].isKing,true);
});
test('active match shows only its two teams and their own mission and king controls',()=>{
    const {ctx,node}=setup(0);ctx.window.renderGagaTeamView();
    const html=node('gaga-team-matchups').innerHTML;
    assert.ok(html.indexOf('미션 룰렛</button>') < html.indexOf('⏱️ 타이머</button>'));
    assert.ok(html.indexOf('심판9</strong>') < html.indexOf('>VS</div>'));
    assert.match(html,/match-referee-avatar/);
    assert.match(html,/학생1/);assert.match(html,/학생2/);assert.doesNotMatch(html,/학생3|학생4/);
    assert.match(html,/king-select-button/);assert.match(html,/team-roulette-0/);assert.match(html,/왕을 잡아라/);
    ctx.window.toggleTeamKing(3,3);assert.equal(ctx.currentGagaTeams[2].members[0].isKing,true);
    ctx.currentTeamMatchIndex=1;ctx.window.renderGagaTeamView();
    assert.match(node('gaga-team-matchups').innerHTML,/학생3/);assert.doesNotMatch(node('gaga-team-matchups').innerHTML,/王|왕을 잡아라|학생1/);
});
test('starting a match clamps the index and clears champions timer context',()=>{
    const {ctx}=setup();
    Object.assign(ctx.window,{closeGagaTimer(){},closeGagaDrawModal(){},switchGagaTab(){}});
    vm.runInContext(section('window.startTeamMatch = function','window.showTeamOverview = function'),ctx);
    ctx.window.startTeamMatch(99);assert.equal(ctx.currentTeamMatchIndex,1);assert.equal(ctx.currentDrawIsChampions,false);
    ctx.isSpinning=true;ctx.window.startTeamMatch(0);assert.equal(ctx.currentTeamMatchIndex,1);
});
test('automatic team scrolling reverses at both ends and limits background-tab jumps',()=>{
    assert.deepEqual(nextTeamScroll(99,0,100,1,100),{top:100,direction:-1,edge:true});
    assert.deepEqual(nextTeamScroll(1,0,100,-1,100),{top:0,direction:1,edge:true});
    assert.equal(nextTeamScroll(50,0,100,1,60000).top,61);
    const bottom = nextTeamScroll(99,0,100,1,100);
    assert.ok(nextTeamScroll(bottom.top,0,100,bottom.direction,16).top < 100);
});

test('cloud refresh keeps zero and absent score values visible in drawn cards',()=>{
    const nodes=[1,2,3].map(no=>({id:`modal-score-${no}`,textContent:'0'}));
    const start=source.indexOf("document.querySelectorAll('[id^=\"modal-score-\"]')");
    const end=source.indexOf('});',start)+3;
    const ctx=vm.createContext({document:{querySelectorAll:()=>nodes},currentClass:'A',classData:{A:[{no:1,score:0},{no:2},{no:3,score:null}]}});
    vm.runInContext(source.slice(start,end),ctx);
    assert.deepEqual(nodes.map(n=>n.textContent),['0','0','0']);
});

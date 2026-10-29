import test from 'node:test';
import assert from 'node:assert/strict';
import {getMatchReferees,getTeamRefereePlan,getRefereeEligibleTeams} from '../app-utils.js';
test('only attending appointed students outside this match officiate',()=>{
 const roster=[{no:1,isReferee:true,attendance:true},{no:2,isReferee:true,attendance:true},{no:3,isReferee:true,attendance:false},{no:4,attendance:true}];
 assert.deepEqual(getMatchReferees(roster,[{no:1}]).map(s=>s.no),[2]);
 assert.deepEqual(getMatchReferees(roster,[]).map(s=>s.no),[1,2]);
});
test('every matchup retains an available referee for 2, 4, 6 and 8 teams',()=>{
 for(const count of [2,4,6,8])for(const refs of [1,2,3,4,8]){
  const roster=Array.from({length:32},(_,i)=>({no:i+1,attendance:true,isReferee:i<refs}));
  const plan=getTeamRefereePlan(roster,count);
  const teams=Array.from({length:count},(_,i)=>({id:i+1,targetSize:Math.floor(plan.participants.length/count)+(i<plan.participants.length%count?1:0),members:[]}));
  for(const s of plan.participants.filter(s=>s.isReferee))getRefereeEligibleTeams(teams)[0].members.push(s);
  for(const s of plan.participants.filter(s=>!s.isReferee))teams.find(t=>t.members.length<t.targetSize).members.push(s);
  for(let i=0;i<count;i+=2)assert.ok(getMatchReferees(roster,[...teams[i].members,...teams[i+1].members]).length>0);
 }
});

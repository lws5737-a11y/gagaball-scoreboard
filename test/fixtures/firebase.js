export const signInWithPopup = async()=>{};
export const signOut = async()=>{};
export const onAuthStateChanged = (_,fn)=>setTimeout(()=>fn({uid:'local-preview-teacher',email:'preview@example.test'}),30);
export const doc = (...parts)=>parts;
export const getDoc = async()=>{const {school}=await(await fetch('/__state')).json();return {exists:()=>true,data:()=>school};};
export class FieldPath { constructor(...parts){this.parts=parts;} }
export function onSnapshot(_,options,callback,error){
    const fn=typeof options==='function'?options:callback;
    if(typeof options==='object' && options.includeMetadataChanges) queueMicrotask(()=>fn({metadata:{hasPendingWrites:false,fromCache:true},exists:()=>true,data:()=>({})}));
    const events=new EventSource('/__events');
    events.onmessage=event=>{const {school}=JSON.parse(event.data);fn({metadata:{hasPendingWrites:false,fromCache:false},exists:()=>true,data:()=>structuredClone(school)});};
    events.onerror=()=>{};return ()=>events.close();
}
export async function runTransaction(_,fn){
    for(let attempt=0;attempt<10;attempt++){
        const {school,revision}=await (await fetch('/__state')).json();let next=structuredClone(school);
        const result=await fn({get:async()=>({exists:()=>true,data:()=>structuredClone(school)}),set:(_,value)=>{next=value;},update:(_,key,value)=>{
            if(key instanceof FieldPath){let target=next;for(const part of key.parts.slice(0,-1))target=target[part]??={};target[key.parts.at(-1)]=value;}
            else Object.assign(next,key);
        }});
        const response=await fetch('/__state',{method:'POST',body:JSON.stringify({revision,school:next})});
        if(response.ok)return result;if(response.status!==409)throw new Error('Preview write failed');
    }
    throw new Error('Preview transaction conflict');
}

import {STUDY_PROJECT_BUDGET_PATH} from './study/project-budget.mjs';
export function memoryStore(){const records=new Map([[STUDY_PROJECT_BUDGET_PATH,{schemaVersion:1,limitMicros:10000000,reservedMicros:0,spentMicros:0}]]);let chain=Promise.resolve();return {records,transact:async run=>{const pending=chain.catch(()=>{}).then(async()=>{const writes=new Map();const result=await run({read:async paths=>paths.map(p=>structuredClone(records.get(p)??null)),write:(p,v)=>writes.set(p,structuredClone(v))});for(const [p,v]of writes)records.set(p,v);return result;});chain=pending;return pending;}};}
export function firestoreStore(records=new Map()){
  let chain=Promise.resolve();
  const doc=path=>({path,collection:name=>({doc:id=>doc(`${path}/${name}/${id}`)})});
  const firestore={doc,collection:name=>({doc:id=>doc(`${name}/${id}`)}),runTransaction(run){
    const operation=chain.catch(()=>{}).then(async()=>{const writes=new Map();
      const read=ref=>{if(writes.size)throw Error('read-after-write');return {exists:records.has(ref.path),data:()=>structuredClone(records.get(ref.path))};};
      const result=await run({get:async ref=>read(ref),getAll:async(...refs)=>{if(!refs.length)throw Error('empty getAll');return refs.map(read);},set:(ref,value)=>writes.set(ref.path,structuredClone(value))});
      for(const [path,value]of writes)records.set(path,value);return result;
    });chain=operation;return operation;
  }};return {firestore,records};
}

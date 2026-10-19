import {requireStudy} from '../study/source.mjs';

// All reads finish before writes are sent, including adaptive wallet -> order reads.
export function createBillingStore(firestore){
  requireStudy(typeof firestore?.runTransaction==='function'&&typeof firestore?.doc==='function','billing_unavailable',503);
  return {transact:reduce=>firestore.runTransaction(async tx=>{
    const pending=new Map();
    const result=await reduce({async read(paths){
      requireStudy(Array.isArray(paths)&&paths.length<=128&&paths.every(p=>typeof p==='string'&&/^[A-Za-z0-9_/-]+$/.test(p)),'billing_ledger_invalid',503);
      return paths.length?(await tx.getAll(...paths.map(p=>firestore.doc(p)))).map(d=>d.exists?d.data():null):[];
    },write(path,value){pending.set(path,value);}});
    for(const [path,value]of pending)tx.set(firestore.doc(path),value);
    return result;
  })};
}

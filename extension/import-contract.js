// Shared data-only contract. No Google identity or token crosses the hosted bridge.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const invalid=()=>{throw Error('The import allowance response could not be verified. Your saved records are kept.');};
export function importPayload(value){
  if(!object(value)||typeof value.operationId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(value.operationId)
    ||!Array.isArray(value.videoIds)||value.videoIds.length<1||value.videoIds.length>100||!value.videoIds.every(id=>typeof id==='string'&&/^[-A-Za-z0-9_]{11}$/.test(id)))invalid();
  return {operationId:value.operationId,videoIds:[...new Set(value.videoIds)]};
}
export function importBalance(value){
  if(!object(value)||value.limit!==10||!integer(value.used)||value.used>value.limit||value.remaining!==value.limit-value.used)invalid();
  return {limit:value.limit,used:value.used,remaining:value.remaining};
}
export function importReceipt(value,expected){
  const result=importPayload(value),input=importPayload(expected),imports=importBalance(value.imports);
  if(result.operationId!==input.operationId||result.videoIds.length!==input.videoIds.length||!input.videoIds.every(id=>result.videoIds.includes(id))
    ||!integer(value.added)||value.added>input.videoIds.length||value.added>imports.used)invalid();
  return {...result,added:value.added,imports};
}

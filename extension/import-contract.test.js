import test from 'node:test';
import assert from 'node:assert/strict';
import {importPayload,importReceipt} from './import-contract.js';
const input={operationId:'job-1',videoIds:['733mgqrzNKs','dI8w0utjUc0']};
const receipt={...input,added:2,imports:{limit:10,used:2,remaining:8}};
test('import transfer contains only bounded operation and canonical distinct IDs',()=>{
  assert.deepEqual(importPayload({...input,videoIds:[...input.videoIds,input.videoIds[0]],token:'private'}),input);
  for(const value of [{...input,operationId:' '},{...input,videoIds:[]},{...input,videoIds:['invalid']},{...input,videoIds:Array(101).fill(input.videoIds[0])}])assert.throws(()=>importPayload(value));
});
test('import receipt must bind its entire selection, operation and coherent balance',()=>{
  assert.deepEqual(importReceipt({...receipt,token:'private',uid:'private'},input),receipt);
  for(const value of [{...receipt,operationId:'foreign'},{...receipt,videoIds:[input.videoIds[0]]},{...receipt,videoIds:[...input.videoIds,'abcdefghijk']},{...receipt,added:11},{...receipt,imports:{limit:10,used:2,remaining:10}}])assert.throws(()=>importReceipt(value,input));
});

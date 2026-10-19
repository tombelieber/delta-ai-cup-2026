import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionBridge, parseExtensionBridgeLocation } from '../src/learning/extension-bridge.mjs';
const extensionId='abcdefghijklmnopabcdefghijklmnop',nonce='a'.repeat(32),url=`https://delta-assistant-613646062582.us-central1.run.app/learn?hosted=1&extension=${extensionId}&request=${nonce}&videoId=733mgqrzNKs`;
test('website bridge accepts only a bounded explicit extension action URL',()=>{
  assert.deepEqual(parseExtensionBridgeLocation(url),{extensionId,requestId:nonce});
  for(const invalid of [url.replace('/learn?','/?'),url.replace('hosted=1','hosted=0'),url.replace(extensionId,'bad'),url.replace(nonce,'short'),`${url}&request=${nonce}`])assert.throws(()=>parseExtensionBridgeLocation(invalid));
});
test('website bridge exchanges only data and binds every message to its launch nonce',async()=>{
  const calls=[],runtime={sendMessage(id,message,callback){calls.push([id,message]);callback({ok:true,action:'learn',payload:{videoId:'733mgqrzNKs'}});}};
  const bridge=createExtensionBridge({location:url,runtime});assert.equal((await bridge.load()).payload.videoId,'733mgqrzNKs');
  await bridge.complete({schemaVersion:1,items:[]});await bridge.fail();
  assert.deepEqual(calls.map(value=>value[1].type),['DELTA_HOSTED_ACTION_GET','DELTA_HOSTED_ACTION_RESULT','DELTA_HOSTED_ACTION_ERROR']);
  assert.ok(calls.every(([id,message])=>id===extensionId&&message.requestId===nonce));assert.equal(JSON.stringify(calls).includes('Authorization'),false);
});
test('website bridge strips credential-like fields before returning classification data',async()=>{
  let sent;const bridge=createExtensionBridge({location:url,runtime:{sendMessage(id,message,callback){sent=message;callback({ok:true});}}});
  await bridge.complete({schemaVersion:1,items:[{videoId:'733mgqrzNKs',path:['Finance','Time value'],confidence:'high',contentType:'knowledge',idToken:'private'}],model:'model',cached:0,idToken:'private',quota:{uid:'private'}});
  assert.equal(JSON.stringify(sent).includes('private'),false);assert.equal(sent.result.items[0].videoId,'733mgqrzNKs');
});
test('website bridge errors stay safe when extension is missing or rejects the tab',async()=>{
  const missing=createExtensionBridge({location:url,runtime:null});await assert.rejects(missing.load(),/extension/);
  const denied=createExtensionBridge({location:url,runtime:{sendMessage(id,message,callback){callback({ok:false,error:'private internal raw text'});}}});await assert.rejects(denied.load(),/Open this action/);
});
test('website failure forwards only allowlisted quota status, without provider diagnostics',async()=>{
  let sent;const bridge=createExtensionBridge({location:url,runtime:{sendMessage(id,message,callback){sent=message;callback({ok:true});}}});
  await bridge.fail({status:429,code:'user_quota_exhausted',message:'raw private provider body'});assert.equal(sent.code,'QUOTA');assert.equal(sent.status,429);assert.equal(JSON.stringify(sent).includes('raw private'),false);
});

test('import receipts strip identity fields and denial preserves the dedicated allowance status',async()=>{
  let sent;const bridge=createExtensionBridge({location:url,runtime:{sendMessage(id,message,callback){sent=message;callback({ok:true});}}});
  await bridge.completeImport({operationId:'one',videoIds:['733mgqrzNKs'],added:1,imports:{limit:10,used:1,remaining:9},uid:'private',idToken:'private'});
  assert.equal(sent.result.operationId,'one');assert.equal(JSON.stringify(sent).includes('private'),false);
  await bridge.fail({status:402,message:'private'});assert.equal(sent.status,402);assert.equal(sent.code,'QUOTA');
});

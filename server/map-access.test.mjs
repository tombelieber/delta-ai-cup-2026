import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapAccess } from './map-access.mjs';

test('personal capability is deterministic, separate from the key, and rejects malformed access', () => {
  const encoded=Buffer.alloc(32,7).toString('base64'),access=createMapAccess({env:{LEARNING_SIGNING_KEY_BASE64:encoded}});
  assert.equal(access.configured,true);assert.notEqual(access.ownerToken(),encoded);
  assert.equal(access.accepts(access.ownerToken()),true);
  for(const value of [null,'',encoded,'a'.repeat(43),[access.ownerToken()],access.ownerToken()+'x'])assert.equal(access.accepts(value),false);
  assert.equal(createMapAccess({env:{LEARNING_SIGNING_KEY_BASE64:encoded}}).ownerToken(),access.ownerToken());
  assert.notEqual(createMapAccess({env:{LEARNING_SIGNING_KEY_BASE64:Buffer.alloc(32,8).toString('base64')}}).ownerToken(),access.ownerToken());
});
test('missing or invalid explicit signing configuration fails closed without legacy fallback',()=>{
  for(const encoded of [undefined,'bad',Buffer.alloc(31).toString('base64'),Buffer.alloc(32).toString('base64')+' ']){
    const access=createMapAccess({env:{LEARNING_SIGNING_KEY_BASE64:encoded,LEARNING_SIGNING_KEY:'legacy'}});
    assert.equal(access.configured,false);assert.equal(access.ownerToken(),null);assert.equal(access.accepts('a'.repeat(43)),false);
  }
});

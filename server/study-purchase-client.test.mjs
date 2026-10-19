import test from 'node:test';import assert from 'node:assert/strict';
import {purchaseFromSearch,purchaseResult,stripeCheckoutUrl} from '../src/learning/study-purchase.mjs';
import {createStudyClient} from '../src/learning/study-client.mjs';
const id='00000000-0000-4000-8000-000000000001';
test('purchase return is an owned-order lookup hint, never a grant or arbitrary redirect',()=>{
  assert.equal(purchaseFromSearch(`?purchase=${id}`),id);assert.equal(purchaseFromSearch('?purchase=cs_test_fixture'),'');assert.equal(purchaseFromSearch('?purchase=../other'),'');
  assert.equal(stripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_fixture'),'https://checkout.stripe.com/c/pay/cs_test_fixture');
  for(const url of ['https://checkout.stripe.com.evil.test/c/pay/x','https://checkout.stripe.com@evil.test/c/pay/x','http://checkout.stripe.com/c/pay/x','https://checkout.stripe.com/redirect','javascript:alert(1)'])assert.throws(()=>stripeCheckoutUrl(url));
  assert.throws(()=>purchaseResult({id,mode:'live',priceUsd:5,status:'granted',granted:true}));assert.throws(()=>purchaseResult({id,mode:'sandbox',priceUsd:5,status:'created',granted:true}));
});
test('frontend accepts checked purchased balances and rejects corrupt or live-mode grants',async()=>{
  let body={schemaVersion:1,imports:{limit:110,used:12,remaining:98},starterPack:{available:true,mode:'sandbox'},paid:{sessions:{limit:20,used:1,reserved:1,remaining:18},classificationAvailable:true}};
  const client=createStudyClient({userId:'alice',getToken:async()=>'synthetic-token',fetchImpl:async()=>new Response(JSON.stringify(body))});
  const result=await client.entitlements();assert.equal(result.paid.sessions.remaining,18);assert.equal(result.imports.remaining,98);
  body={...body,paid:{...body.paid,sessions:{...body.paid.sessions,remaining:19}}};await assert.rejects(client.entitlements());
  body={...body,starterPack:{available:true,mode:'live'}};await assert.rejects(client.entitlements());
});

import test from 'node:test';import assert from 'node:assert/strict';
import {purchaseFromSearch,purchaseResult,stripeCheckoutUrl,purchaseCheckoutRequest,purchaseCheckoutResult} from '../src/learning/study-purchase.mjs';
import {createStudyClient} from '../src/learning/study-client.mjs';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {createServer} from 'vite';
const id='00000000-0000-4000-8000-000000000001';
test('purchase return is an owned-order lookup hint, never a grant or arbitrary redirect',()=>{
  assert.equal(purchaseFromSearch(`?purchase=${id}`),id);assert.equal(purchaseFromSearch('?purchase=cs_test_fixture'),'');assert.equal(purchaseFromSearch('?purchase=../other'),'');
  assert.equal(stripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_fixture'),'https://checkout.stripe.com/c/pay/cs_test_fixture');
  for(const url of ['https://checkout.stripe.com.evil.test/c/pay/x','https://checkout.stripe.com@evil.test/c/pay/x','http://checkout.stripe.com/c/pay/x','https://checkout.stripe.com/redirect','javascript:alert(1)'])assert.throws(()=>stripeCheckoutUrl(url));
  for(const mode of ['sandbox','live'])assert.equal(purchaseResult({id,mode,priceUsd:5,status:'granted',granted:true}).mode,mode);
  for(const mode of [undefined,null,'test','production','LIVE'])assert.throws(()=>purchaseResult({id,mode,priceUsd:5,status:'granted',granted:true}));
  for(const mode of ['sandbox','live']){
    assert.throws(()=>purchaseResult({id,mode,priceUsd:5,status:'created',granted:true}));
    assert.throws(()=>purchaseResult({id,mode,priceUsd:5,status:'granted',granted:false}));
    assert.throws(()=>purchaseResult({id,mode,priceUsd:50,status:'granted',granted:true}));
  }
});
test('frontend accepts checked purchased balances in both modes and rejects corrupt grants',async()=>{
  let body={schemaVersion:1,imports:{limit:110,used:12,remaining:98},starterPack:{available:true,mode:'sandbox'},paid:{sessions:{limit:20,used:1,reserved:1,remaining:18},classificationAvailable:true}};
  const client=createStudyClient({userId:'alice',getToken:async()=>'synthetic-token',fetchImpl:async()=>new Response(JSON.stringify(body))});
  for(const mode of ['sandbox','live']){body.starterPack={available:true,mode};const result=await client.entitlements();assert.equal(result.paid.sessions.remaining,18);assert.equal(result.imports.remaining,98);assert.equal(result.starterPack.mode,mode);}
  body={...body,paid:{...body.paid,sessions:{...body.paid.sessions,remaining:19}}};await assert.rejects(client.entitlements());
  body={...body,paid:{...body.paid,sessions:{...body.paid.sessions,remaining:18}},starterPack:{available:true,mode:'unknown'}};await assert.rejects(client.entitlements());
});
test('owned checkout resume keeps the original id and mode while new checkout replay requires explicit consent',()=>{
  const oldOrder={id,mode:'sandbox',priceUsd:5,status:'created',granted:false,checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_existing'},requestId='00000000-0000-4000-8000-000000000002';
  assert.deepEqual(purchaseCheckoutRequest({requestId}),{requestId});
  assert.deepEqual(purchaseCheckoutRequest({requestId,existingOrder:oldOrder}),{orderId:id});
  assert.throws(()=>purchaseCheckoutRequest({requestId:'invalid'}));assert.throws(()=>purchaseCheckoutRequest({existingOrder:{...oldOrder,status:'granted',granted:true}}));
  const replay=purchaseCheckoutResult(oldOrder,{offeredMode:'live'});assert.equal(replay.purchase,oldOrder);assert.equal(replay.modeMismatch,true);assert.equal(replay.href,'');
  const resumed=purchaseCheckoutResult({...oldOrder},{offeredMode:'live',existingOrder:oldOrder});assert.equal(resumed.purchase.mode,'sandbox');assert.equal(resumed.modeMismatch,false);assert.equal(resumed.href,oldOrder.checkoutUrl);
  assert.throws(()=>purchaseCheckoutResult({...oldOrder,id:requestId},{offeredMode:'live',existingOrder:oldOrder}),/original purchase was kept/);
  assert.throws(()=>purchaseCheckoutResult({...oldOrder,mode:'live'},{offeredMode:'live',existingOrder:oldOrder}),/original purchase was kept/);
  assert.throws(()=>purchaseCheckoutResult({...oldOrder,checkoutUrl:'https://evil.test/pay'},{existingOrder:oldOrder}),/payment link could not be verified/);
  const paid=purchaseCheckoutResult({...oldOrder,status:'granted',granted:true},{existingOrder:oldOrder});assert.equal(paid.href,'');assert.equal(paid.purchase.status,'granted');
  const live={...oldOrder,mode:'live',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_live_new'};assert.equal(purchaseCheckoutResult(live,{offeredMode:'live'}).href,live.checkoutUrl);
});
test('checkout copy distinguishes real US$5 payments from Sandbox tests and preserves old order mode',async()=>{
  const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[],include:[]},server:{middlewareMode:true,watch:null,hmr:false},logLevel:'error'});
  try{
    const module=await server.ssrLoadModule('/src/learning/StudyPurchase.jsx');
    const auth={getToken:async()=>{throw Error('Rendering must not request credentials.');}},user={uid:'synthetic-user'};
    const render=mode=>renderToStaticMarkup(React.createElement(module.default,{auth,state:{user,entitlements:{starterPack:{available:true,mode}}}}));
    const live=render('live');assert.match(live,/US\$5 one-time/);assert.match(live,/Buy Starter Pack · US\$5/);assert.doesNotMatch(live,/Sandbox|No real money/);
    const sandbox=render('sandbox');assert.match(sandbox,/Sandbox checkout is for approved test accounts only/);assert.match(sandbox,/no real money is charged/);assert.match(sandbox,/Try US\$5 Sandbox checkout/);
    const unavailable=render('unknown');assert.match(unavailable,/Purchases are currently unavailable/);assert.doesNotMatch(unavailable,/Buy Starter Pack/);
    const oldOrder=purchaseResult({id,mode:'sandbox',priceUsd:5,status:'granted',granted:true});
    const status=renderToStaticMarkup(React.createElement(module.PurchaseStatus,{purchase:oldOrder}));
    assert.match(status,/Sandbox test purchase\. No real money was charged/);assert.match(status,/Test allowance verified and ready/);assert.doesNotMatch(status,/Payment verified|US\$5 purchase/);
    const paidStatus=renderToStaticMarkup(React.createElement(module.PurchaseStatus,{purchase:{...oldOrder,mode:'live'}}));assert.match(paidStatus,/US\$5 purchase/);assert.match(paidStatus,/Payment verified/);assert.doesNotMatch(paidStatus,/Sandbox/);
    const pending=renderToStaticMarkup(React.createElement(module.PurchaseStatus,{purchase:{...oldOrder,mode:'live',status:'created',granted:false}}));assert.match(pending,/Purchase confirmation pending/);assert.doesNotMatch(pending,/Payment verified/);
    const actions=purchase=>renderToStaticMarkup(React.createElement(module.PurchaseActions,{enabled:true,mode:'live',purchase,busy:false,orderId:id,perform(){throw Error('Rendering must not open checkout.');}}));
    const changed=actions({...oldOrder,status:'created',granted:false});assert.match(changed,/Sandbox test purchase keeps its original checkout mode/);assert.match(changed,/<button type="button">Continue Sandbox test checkout<\/button>/);assert.match(changed,/<button type="button">Check this purchase<\/button>/);assert.doesNotMatch(changed,/disabled=""|Continue US\$5 checkout/);
    const calls=[],created={...oldOrder,status:'created',granted:false},controls=module.PurchaseActions({enabled:false,mode:'live',purchase:created,busy:false,orderId:id,perform:(...args)=>calls.push(args)});
    const buttons=controls.props.children.filter(child=>child?.type==='button');buttons[0].props.onClick();buttons[1].props.onClick();assert.deepEqual(calls,[[false,true],[true]]);
    const reconciled=actions(oldOrder);assert.match(reconciled,/Buy another US\$5 pack/);assert.doesNotMatch(reconciled,/disabled=""|another Sandbox/);
  }finally{await server.close();}
});

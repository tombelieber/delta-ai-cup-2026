import {randomUUID} from 'node:crypto';
import {requireStudy} from '../study/source.mjs';
import {projectBudgetState,STUDY_PROJECT_BUDGET_PATH} from '../study/project-budget.mjs';
import {PACK,CAPACITY,checkoutUrl,billingKeys,check,integer,validId,walletPath,orderPath,walletState,orderState,readWalletOrders,activeOrders,importPaidBalance} from './policy.mjs';

export function createPurchaseLedger({store,key,merchantId,now=Date.now,newId=randomUUID}){
  check(typeof store?.transact==='function'&&/^acct_[A-Za-z0-9]+$/.test(merchantId));
  const keys=billingKeys(key),writeOrder=(tx,o)=>{o.updatedAt=now();tx.write(orderPath(o.id),o);};
  async function readOrder(tx,id){requireStudy(validId(id),'invalid_purchase',400);return orderState((await tx.read([orderPath(id)]))[0]);}
  const publicOrder=o=>({id:o.id,status:o.status,granted:o.granted,...(o.status==='created'&&o.checkoutUrl?{checkoutUrl:o.checkoutUrl}:{}),mode:'sandbox',priceUsd:5});
  const txOrder=(id,reduce)=>store.transact(async tx=>reduce(tx,await readOrder(tx,id)));
  return {
    keys,store,
    async snapshot(uid){return store.transact(async tx=>{const {orders}=await readWalletOrders(tx,keys.user(uid)),active=activeOrders(orders);
      return {imports:importPaidBalance(orders),sessions:{limit:active.length*20,used:active.reduce((s,o)=>s+o.sessionsUsed,0),reserved:active.reduce((s,o)=>s+o.sessionsHeld,0),remaining:active.reduce((s,o)=>s+20-o.sessionsUsed-o.sessionsHeld,0)}};});},
    async order(id,uid){return txOrder(id,(_tx,o)=>{requireStudy(uid===undefined||o.userKey===keys.user(uid),'purchase_access_denied',403);check(o.merchantId===merchantId);return o;});},
    publicOrder,
    async open(uid,requestId){
      requireStudy(validId(requestId),'invalid_purchase',400);const user=keys.user(uid),id=newId(),requestPath=`studyCheckoutRequests/${keys.hash('checkout-request',`${user}\0${requestId}`)}`;
      return store.transact(async tx=>{
        const [saved,rawWallet,rawBudget]=await tx.read([requestPath,walletPath(user),STUDY_PROJECT_BUDGET_PATH]);
        const wallet=walletState(rawWallet),budget=projectBudgetState(rawBudget);
        if(saved){check(validId(saved.orderId));const existing=await readOrder(tx,saved.orderId);check(existing.userKey===user&&existing.merchantId===merchantId);return existing;}
        if(wallet.activeOrderId){const existing=await readOrder(tx,wallet.activeOrderId);check(existing.userKey===user&&existing.merchantId===merchantId);return existing;}
        requireStudy(wallet.orderIds.length<32,'purchase_capacity',503,'Your purchase ledger is full. Contact support.');
        requireStudy(budget.reservedMicros+budget.spentMicros+PACK.capacityMicros<=budget.limitMicros,'pack_capacity_unavailable',409,'This pack is temporarily unavailable: fulfilment capacity is fully reserved. No payment was taken.');
        const order={schemaVersion:1,id,userKey:user,merchantId,livemode:false,status:'created',granted:false,capacityReserved:false,
          checkoutId:null,checkoutUrl:null,expiresAt:0,paymentIntentId:null,importsUsed:0,sessionsUsed:0,sessionsHeld:0,
          available:{...CAPACITY},held:{learning:0,classification:0,recovery:0},spent:{learning:0,classification:0,recovery:0},createdAt:now(),updatedAt:now()};
        wallet.orderIds.push(id);wallet.activeOrderId=id;tx.write(walletPath(user),wallet);tx.write(requestPath,{orderId:id});writeOrder(tx,order);return order;
      });
    },
    attach(id,checkout){return txOrder(id,(tx,o)=>{check(o.status==='created'&&(!o.checkoutId||o.checkoutId===checkout.id));
      check(/^cs_test_[A-Za-z0-9]+$/.test(checkout.id)&&checkoutUrl(checkout.url,checkout.id)&&integer(checkout.expiresAt));
      o.checkoutId=checkout.id;o.checkoutUrl=checkout.url;o.expiresAt=checkout.expiresAt;writeOrder(tx,o);return publicOrder(o);});},
    reserveCapacity(id,paymentIntentId){return txOrder(id,async(tx,o)=>{
      check(/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)&&o.checkoutId&&(!o.paymentIntentId||o.paymentIntentId===paymentIntentId));
      requireStudy(['created','capacity_reserved','reconciliation_required'].includes(o.status),'purchase_state_conflict',409);
      if(o.capacityReserved)return o;
      requireStudy(o.status==='created','purchase_state_conflict',409);
      const [raw]=await tx.read([STUDY_PROJECT_BUDGET_PATH]),budget=projectBudgetState(raw);
      requireStudy(budget.reservedMicros+budget.spentMicros+PACK.capacityMicros<=budget.limitMicros,'pack_capacity_unavailable',409,'No fulfilment capacity remains. The authorization will be canceled.');
      budget.reservedMicros+=PACK.capacityMicros;o.capacityReserved=true;o.status='capacity_reserved';o.paymentIntentId=paymentIntentId;
      tx.write(STUDY_PROJECT_BUDGET_PATH,budget);tx.write(`studyPaymentIntents/${paymentIntentId}`,{orderId:id});writeOrder(tx,o);return o;
    });},
    grant(id,paymentIntentId){return txOrder(id,async(tx,o)=>{
      if(o.granted)return publicOrder(o);
      check(o.capacityReserved&&o.paymentIntentId===paymentIntentId&&['capacity_reserved','reconciliation_required'].includes(o.status));
      const [raw]=await tx.read([walletPath(o.userKey)]),wallet=walletState(raw);o.status='granted';o.granted=true;if(wallet.activeOrderId===id)wallet.activeOrderId=null;
      tx.write(walletPath(o.userKey),wallet);writeOrder(tx,o);return publicOrder(o);
    });},
    markUnknown(id){return txOrder(id,(tx,o)=>{if(!['canceled','refunded','granted'].includes(o.status)){o.status='reconciliation_required';writeOrder(tx,o);}return publicOrder(o);});},
    revoke(id,{refunded=false}={}){return txOrder(id,async(tx,o)=>{
      if(['canceled','refunded'].includes(o.status))return publicOrder(o);
      check(refunded||!o.granted);const [rawWallet,rawBudget]=await tx.read([walletPath(o.userKey),STUDY_PROJECT_BUDGET_PATH]);
      const wallet=walletState(rawWallet),budget=projectBudgetState(rawBudget),released=o.capacityReserved?Object.values(o.available).reduce((a,b)=>a+b,0):0;
      check(budget.reservedMicros>=released);budget.reservedMicros-=released;for(const k of Object.keys(CAPACITY))o.available[k]=0;
      o.status=refunded?'refunded':'canceled';if(wallet.activeOrderId===id)wallet.activeOrderId=null;
      tx.write(walletPath(o.userKey),wallet);tx.write(STUDY_PROJECT_BUDGET_PATH,budget);writeOrder(tx,o);return publicOrder(o);
    });},
    async findOrder(paymentIntentId){if(!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId||''))return null;return store.transact(async tx=>(await tx.read([`studyPaymentIntents/${paymentIntentId}`]))[0]?.orderId||null);},
  };
}

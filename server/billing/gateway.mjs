import {requireStudy} from '../study/source.mjs';
import {billingKeys,check,orderPath,orderState,paymentTarget,validId} from './policy.mjs';

// A merchant change affects new sales only. Existing purchases retain their
// original provider, signing secret and mode, including interrupted captures.
export function createBillingGateway({store,key,current=null,legacy=[]}){
  const keys=billingKeys(key),entries=[current,...legacy].filter(Boolean),targets=new Map();
  check(entries.length<=2);
  for(const entry of entries){const target=paymentTarget(entry.ledger);check(!targets.has(target));targets.set(target,entry);}
  async function purchase(id,uid){
    requireStudy(validId(id),'invalid_purchase',400);
    const order=await store.transact(async tx=>orderState((await tx.read([orderPath(id)]))[0]));
    requireStudy(uid===undefined||order.userKey===keys.user(uid),'purchase_access_denied',403);
    const entry=targets.get(paymentTarget(order));
    requireStudy(entry,'purchase_provider_unavailable',503,'This purchase needs its original payment provider. Saved learning and existing allowance are kept.');
    return entry;
  }
  return {
    mode:current?.service.mode,
    canPurchase:uid=>Boolean(current?.service.canPurchase(uid)),
    async checkout(uid,input){
      if(input&&Object.keys(input).length===1&&validId(input.orderId))return (await purchase(input.orderId,uid)).service.resumeCheckout(input.orderId,uid);
      requireStudy(current,'payments_unavailable',503,'New purchases are unavailable. Your saved work and existing allowance are kept.');
      const order=await current.service.checkout(uid,input);
      if(order.status==='created'&&!order.checkoutUrl){const entry=await purchase(order.id,uid);if(entry!==current)return entry.service.resumeCheckout(order.id,uid);}
      return order;
    },
    async reconcile(id,uid){return (await purchase(id,uid)).service.reconcile(id,uid);},
    async webhook(raw,signature){
      for(const entry of entries){
        try{entry.provider.event(raw,signature);}
        catch(error){if(error.code==='invalid_payment_signature')continue;throw error;}
        // Only the provider whose secret authenticated the raw event may act.
        // Its service also verifies mode and the immutable order target.
        return entry.service.webhook(raw,signature);
      }
      requireStudy(false,'invalid_payment_signature',400,'The payment event signature could not be verified.');
    },
  };
}

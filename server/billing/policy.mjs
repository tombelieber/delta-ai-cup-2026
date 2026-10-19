import {createHmac} from 'node:crypto';
import {requireStudy} from '../study/source.mjs';
export const PACK=Object.freeze({id:'delta-starter-v1',amount:500,currency:'usd',imports:100,sessions:20,capacityMicros:2500000});
export const CAPACITY=Object.freeze({learning:2000000,classification:250000,recovery:250000});
export const integer=value=>Number.isSafeInteger(value)&&value>=0;
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const check=condition=>requireStudy(condition,'billing_ledger_invalid',503,'Purchase accounting could not be verified. Saved learning is kept.');
export function billingKeys(key){
  check(Buffer.isBuffer(key)&&key.length===32);
  const hash=(kind,value)=>createHmac('sha256',key).update(`delta-${kind}-v1\0${value}`).digest('hex');
  return {user(uid){requireStudy(typeof uid==='string'&&uid.length>0&&uid.length<=128,'authentication_required',401);return hash('import-user',uid);},hash};
}
export const walletPath=user=>`studyPaidWallets/${user}`;
export function checkoutUrl(value,id){try{const u=new URL(value);return typeof value==='string'&&value.length<=8192&&u.origin==='https://checkout.stripe.com'&&!u.username&&!u.password&&u.pathname===`/c/pay/${id}`;}catch{return false;}}
export const orderPath=id=>`studyPurchases/${id}`;
export function walletState(value){
  if(value===null)return {schemaVersion:1,orderIds:[],activeOrderId:null};
  check(object(value)&&value.schemaVersion===1&&Object.keys(value).length===3&&Array.isArray(value.orderIds)&&value.orderIds.length<=32
    &&value.orderIds.every(validId)&&new Set(value.orderIds).size===value.orderIds.length&&(value.activeOrderId===null||value.orderIds.includes(value.activeOrderId)));
  return structuredClone(value);
}
export function orderState(value){
  check(object(value)&&value.schemaVersion===1&&validId(value.id)&&/^[a-f0-9]{64}$/.test(value.userKey)&&value.livemode===false
    &&/^acct_[A-Za-z0-9]+$/.test(value.merchantId)&&['created','capacity_reserved','granted','canceled','refunded','reconciliation_required'].includes(value.status)
    &&typeof value.granted==='boolean'&&typeof value.capacityReserved==='boolean'&&integer(value.importsUsed)&&value.importsUsed<=100
    &&integer(value.sessionsUsed)&&integer(value.sessionsHeld)&&value.sessionsUsed+value.sessionsHeld<=20&&integer(value.createdAt)&&integer(value.updatedAt));
  for(const name of ['available','held','spent'])check(object(value[name])&&Object.keys(value[name]).length===3&&Object.keys(CAPACITY).every(k=>integer(value[name][k])));
  check(!value.granted||value.capacityReserved);
  if(value.status==='granted'){check(value.granted&&value.capacityReserved&&value.checkoutId&&value.paymentIntentId);for(const k of Object.keys(CAPACITY))check(value.available[k]+value.held[k]+value.spent[k]===CAPACITY[k]);}
  check(value.checkoutId===null||/^cs_test_[A-Za-z0-9]+$/.test(value.checkoutId));
  check(value.paymentIntentId===null||/^pi_[A-Za-z0-9]+$/.test(value.paymentIntentId));
  check(integer(value.expiresAt)&&(value.checkoutUrl===null||checkoutUrl(value.checkoutUrl,value.checkoutId)));
  return structuredClone(value);
}
export const activeOrders=orders=>orders.filter(o=>o.status==='granted'&&o.granted);
export function importPaidBalance(orders){const granted=orders.filter(o=>o.granted),used=granted.reduce((n,o)=>n+o.importsUsed,0),remaining=activeOrders(orders).reduce((n,o)=>n+100-o.importsUsed,0);return {limit:used+remaining,used,remaining};}
export async function readWalletOrders(tx,user){
  const [raw]=await tx.read([walletPath(user)]),wallet=walletState(raw);
  const orders=(await tx.read(wallet.orderIds.map(orderPath))).map(orderState);check(orders.every(o=>o.userKey===user));return {wallet,orders};
}
export function consumePaidImports(orders,amount){
  check(integer(amount)&&amount<=importPaidBalance(orders).remaining);
  const updates=[];
  for(const order of activeOrders(orders)){const used=Math.min(amount,100-order.importsUsed);if(used){order.importsUsed+=used;amount-=used;updates.push(order);}if(!amount)break;}
  return updates;
}

import {requireStudy} from '../study/source.mjs';
import {projectBudgetState,STUDY_PROJECT_BUDGET_PATH,PROJECT_BUDGET_ENFORCED} from '../study/project-budget.mjs';
import {billingKeys,check,integer,orderPath,orderState,readWalletOrders,activeOrders,importPaidBalance,CAPACITY} from './policy.mjs';
const cost=value=>{requireStudy(Number.isFinite(value)&&value>=0,'invalid_credit_amount',400);const v=Math.ceil(value*1e6);check(integer(v));return v;};
const sessionState=value=>{check(value&&value.schemaVersion===1&&typeof value.userKey==='string'&&typeof value.orderId==='string'&&['generating','complete','failed','classification'].includes(value.status)
  &&Array.isArray(value.operationKeys)&&value.operationKeys.length<=128&&value.operationKeys.every(k=>/^[a-f0-9]{64}$/.test(k))&&integer(value.spentMicros)&&integer(value.reservedMicros)&&typeof value.unitUsed==='boolean'&&value.questions&&Object.keys(value.questions).length<=2);return structuredClone(value);};
export function createPaidUsage({store,key,now=Date.now}){
  const keys=billingKeys(key),sessionKey=(uid,id)=>keys.hash('paid-session',`${keys.user(uid)}\0${id}`),path=(uid,id)=>`studyPaidSessions/${sessionKey(uid,id)}`;
  const deliveryPath=(uid,id)=>`studyPaidDeliveries/${sessionKey(uid,id)}`;
  async function owned(tx,uid,id){const [raw]=await tx.read([path(uid,id)]),s=sessionState(raw);requireStudy(s.userKey===keys.user(uid),'lesson_access_denied',403);const [o]=await tx.read([orderPath(s.orderId)]);const order=orderState(o);check(order.userKey===s.userKey);return {s,order};}
  const save=(tx,uid,id,s,order)=>{order.updatedAt=now();tx.write(path(uid,id),s);tx.write(orderPath(order.id),order);};
  async function begin(uid,id,kind='learning'){
    check(['learning','classification'].includes(kind));
    return store.transact(async tx=>{
      const [raw]=await tx.read([path(uid,id)]);
      if(raw){const s=sessionState(raw);requireStudy(s.userKey===keys.user(uid),'lesson_access_denied',403);
        if(s.status==='complete'){const [d]=await tx.read([deliveryPath(uid,id)]);check(typeof d?.lessonToken==='string');return {lessonToken:d.lessonToken};}
        if(kind==='classification'&&s.status==='classification')return {created:false};
        requireStudy(s.status==='failed','paid_session_busy',409,'This paid learning request is still pending. Check its existing result before trying again.');
        const [value]=await tx.read([orderPath(s.orderId)]),order=orderState(value);requireStudy(order.status==='granted'&&order.sessionsUsed+order.sessionsHeld<20,'paid_allowance_exhausted',402);
        requireStudy(s.spentMicros+s.reservedMicros<100000,'video_budget_exceeded',429);order.sessionsHeld++;s.status='generating';save(tx,uid,id,s,order);return {created:true};
      }
      const {orders}=await readWalletOrders(tx,keys.user(uid)),order=activeOrders(orders).find(o=>o.available[kind]>0&&(kind!=='learning'||o.sessionsUsed+o.sessionsHeld<20));
      requireStudy(order,'paid_allowance_exhausted',402,'No purchased learning allowance is available. Saved results remain available.');
      const s={schemaVersion:1,userKey:keys.user(uid),orderId:order.id,status:kind==='learning'?'generating':'classification',spentMicros:0,reservedMicros:0,unitUsed:false,questions:{},operationKeys:[]};
      if(kind==='learning')order.sessionsHeld++;save(tx,uid,id,s,order);return {created:true};
    });
  }
  async function finish(uid,id,lessonToken){check(typeof lessonToken==='string'&&lessonToken.length<=100000);return store.transact(async tx=>{
    const {s,order}=await owned(tx,uid,id);if(s.status==='complete')return;
    check(s.status==='generating'&&!s.unitUsed&&order.sessionsHeld>0);order.sessionsHeld--;order.sessionsUsed++;s.status='complete';s.unitUsed=true;
    tx.write(deliveryPath(uid,id),{schemaVersion:1,lessonToken,answers:{}});save(tx,uid,id,s,order);
  });}
  async function recoverOperations(tx,s,order,questionId=null){
    const operations=await tx.read(s.operationKeys.map(k=>`studyPaidOperations/${k}`));
    for(let i=0;i<operations.length;i++){
      const op=operations[i];check(op?.userKey===s.userKey);
      if(op.category!=='learning'||(op.questionId||null)!==questionId)continue;
      const settled=op.status==='settled',amount=settled?op.actualMicros:op.reservedMicros;
      if(order.status==='refunded'||order.status==='canceled')continue;
      if(order.available.recovery<amount){order.status='reconciliation_required';continue;}
      order.available.recovery-=amount;order.available.learning+=amount;
      if(settled){check(order.spent.learning>=amount);order.spent.learning-=amount;order.spent.recovery+=amount;}
      else{check(order.held.learning>=amount);order.held.learning-=amount;order.held.recovery+=amount;}
      op.category='recovery';tx.write(`studyPaidOperations/${s.operationKeys[i]}`,op);
    }
  }
  async function fail(uid,id){return store.transact(async tx=>{
    const [raw]=await tx.read([path(uid,id)]);if(!raw)return;
    const {s,order}=await owned(tx,uid,id);if(s.status!=='generating')return;check(order.sessionsHeld>0);order.sessionsHeld--;s.status='failed';
    await recoverOperations(tx,s,order);save(tx,uid,id,s,order);
  });}
  async function question(uid,id,questionId){return store.transact(async tx=>{
    const {s,order}=await owned(tx,uid,id);requireStudy(s.status==='complete','paid_allowance_exhausted',402);
    if(s.questions[questionId]?.status==='complete'){const [d]=await tx.read([deliveryPath(uid,id)]);check(typeof d?.answers?.[questionId]==='string');return {answerToken:d.answers[questionId]};}
    requireStudy(order.status==='granted','paid_allowance_exhausted',402);
    requireStudy(!s.questions[questionId],'paid_session_busy',409,'This follow-up is already pending.');
    requireStudy(Object.keys(s.questions).length<2,'paid_followups_exhausted',402,'This learning session includes two follow-up answers. Your lesson and exports remain available.');
    s.questions[questionId]={status:'pending'};save(tx,uid,id,s,order);return {created:true};
  });}
  async function finishQuestion(uid,id,questionId,answerToken){return store.transact(async tx=>{
    const {s,order}=await owned(tx,uid,id);check(s.questions[questionId]?.status==='pending'&&typeof answerToken==='string'&&answerToken.length<=100000);
    const [d]=await tx.read([deliveryPath(uid,id)]);check(d?.lessonToken&&d.answers);d.answers[questionId]=answerToken;s.questions[questionId]={status:'complete'};tx.write(deliveryPath(uid,id),d);save(tx,uid,id,s,order);
  });}
  async function failQuestion(uid,id,questionId){return store.transact(async tx=>{const {s,order}=await owned(tx,uid,id);if(s.questions[questionId]?.status==='pending'){delete s.questions[questionId];await recoverOperations(tx,s,order,questionId);save(tx,uid,id,s,order);}});}
  function forUser(uid,{kind='learning',questionId=null}={}){
    const user=keys.user(uid);
    return {
      async check(){return store.transact(async tx=>{const {orders}=await readWalletOrders(tx,user);requireStudy(activeOrders(orders).some(o=>o.available[kind]>0),'paid_allowance_exhausted',402);return {remainingUsd:1};});},
      async session(id){return store.transact(async tx=>{const [raw]=await tx.read([path(uid,id)]);if(!raw)return {available:false};const s=sessionState(raw);check(s.userKey===user);return {available:true,conservativeUsd:(s.spentMicros+s.reservedMicros)/1e6,spentUsd:s.spentMicros/1e6,reservedUsd:s.reservedMicros/1e6,limitUsd:.1};});},
      async reserve({operationId,sessionId,amountUsd}){
        if(kind==='classification')await begin(uid,sessionId,kind);
        const amount=cost(amountUsd),opPath=`studyPaidOperations/${keys.hash('paid-operation',`${user}\0${operationId}`)}`;
        return store.transact(async tx=>{
          const [existing]=await tx.read([opPath]),{s,order}=await owned(tx,uid,sessionId);
          if(existing){check(existing.sessionId===sessionId&&existing.reservedMicros===amount);return {created:false,operationState:existing.status};}
          requireStudy(order.status==='granted'&&['generating','complete','classification'].includes(s.status),'paid_allowance_exhausted',402);
          requireStudy(amount>0&&s.reservedMicros+s.spentMicros+amount<100000,'video_budget_exceeded',429);
          requireStudy(order.available[kind]>=amount,'paid_capacity_exhausted',429,'The funded allocation is used or reserved. Saved results remain available.');
          requireStudy(s.operationKeys.length<128,'paid_capacity_exhausted',429);
          if(questionId)check(s.questions[questionId]?.status==='pending');
          s.operationKeys.push(opPath.split('/')[1]);
          order.available[kind]-=amount;order.held[kind]+=amount;s.reservedMicros+=amount;
          tx.write(opPath,{schemaVersion:1,userKey:user,sessionId,kind,questionId,category:kind,status:'reserved',reservedMicros:amount,actualMicros:0});save(tx,uid,sessionId,s,order);return {created:true,operationState:'reserved'};
        });
      },
      async settle({operationId,actualUsd}){
        const actual=cost(actualUsd),opPath=`studyPaidOperations/${keys.hash('paid-operation',`${user}\0${operationId}`)}`;
        return store.transact(async tx=>{
          const [op]=await tx.read([opPath]);check(op?.userKey===user&&op.kind===kind&&['reserved','failed','settled'].includes(op.status));
          if(op.status==='settled'){check(op.actualMicros===actual);return;}
          const {s,order}=await owned(tx,uid,op.sessionId),[rawBudget]=await tx.read([STUDY_PROJECT_BUDGET_PATH]),budget=projectBudgetState(rawBudget),reserved=op.reservedMicros,category=op.category;check(Object.hasOwn(CAPACITY,category));
          check(s.reservedMicros>=reserved&&order.held[category]>=reserved&&budget.reservedMicros>=reserved);
          s.reservedMicros-=reserved;s.spentMicros+=actual;order.held[category]-=reserved;order.spent[category]+=actual;
          const refund=reserved-actual;
          if(order.status==='refunded'||order.status==='canceled'){budget.reservedMicros-=reserved;}
          else if(refund>=0){order.available[category]+=refund;budget.reservedMicros-=actual;}
          else{const extra=Math.min(-refund,order.available[category]);order.available[category]-=extra;budget.reservedMicros-=reserved+extra;order.status='reconciliation_required';}
          budget.spentMicros+=actual;op.status='settled';op.actualMicros=actual;tx.write(opPath,op);tx.write(STUDY_PROJECT_BUDGET_PATH,budget);save(tx,uid,op.sessionId,s,order);
        });
      },
      async failure({operationId}){const p=`studyPaidOperations/${keys.hash('paid-operation',`${user}\0${operationId}`)}`;return store.transact(async tx=>{const [op]=await tx.read([p]);if(op&&op.status==='reserved'){check(op.userKey===user);op.status='failed';tx.write(p,op);}});},
    };
  }
  async function snapshot(uid){return store.transact(async tx=>{const {orders}=await readWalletOrders(tx,keys.user(uid)),active=activeOrders(orders);return {imports:importPaidBalance(orders),sessions:{limit:active.length*20,used:active.reduce((n,o)=>n+o.sessionsUsed,0),reserved:active.reduce((n,o)=>n+o.sessionsHeld,0),remaining:active.reduce((n,o)=>n+20-o.sessionsUsed-o.sessionsHeld,0)},classificationAvailable:active.some(o=>o.available.classification>0)};});}
  return {[PROJECT_BUDGET_ENFORCED]:true,snapshot,begin,finish,fail,question,finishQuestion,failQuestion,forUser,questionKey:value=>keys.hash('paid-question',value)};
}

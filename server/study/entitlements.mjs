import {createHmac} from 'node:crypto';
import {readWalletOrders,importPaidBalance,consumePaidImports,orderPath} from '../billing/policy.mjs';
import {StudyError, requireStudy} from './source.mjs';

const FREE_IMPORTS = 10;
const HASH = /^[a-f0-9]{64}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const unavailable = condition => requireStudy(condition, 'import_ledger_unavailable', 503,
  'Your import allowance could not be verified. Saved records remain available.');

function accountState(value) {
  if (value === null) return {schemaVersion: 1, usedImports: 0, updatedAtMs: 0};
  unavailable(exact(value, ['schemaVersion', 'usedImports', 'updatedAtMs']) && value.schemaVersion === 1
    && integer(value.usedImports) && value.usedImports <= FREE_IMPORTS && integer(value.updatedAtMs));
  return {...value};
}
const balance = (account,paid={limit:0,used:0,remaining:0}) => ({limit: FREE_IMPORTS+paid.limit, used: account.usedImports+paid.used, remaining: FREE_IMPORTS-account.usedImports+paid.remaining});
const snapshot = (account,paid) => ({schemaVersion: 1, imports: balance(account,paid),
  starterPack: {priceUsd: 5, additionalImports: 100, studySessions: 20, available: false}});

function videoIds(input) {
  requireStudy(Array.isArray(input) && input.length > 0 && input.length <= 100 && input.every(id => typeof id === 'string' && VIDEO.test(id)),
    'invalid_import_registration', 400, 'Choose at most 100 valid YouTube videos.');
  return [...new Set(input)];
}

export function createStudyEntitlements({store, key, now = Date.now} = {}) {
  unavailable(Buffer.isBuffer(key) && key.length === 32 && typeof store?.transact === 'function');
  const hash = (kind, value) => createHmac('sha256', key).update(`delta-import-${kind}-v1\0${value}`).digest('hex');
  function forUser(uid) {
    requireStudy(typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !/[\u0000-\u001f\u007f]/.test(uid),
      'authentication_required', 401);
    const userKey = hash('user', uid);
    const keyed = ids => ids.map(id => hash('video', `${userKey}\0${id}`));
    async function transaction(operation, ids, reduce) {
      const keys = keyed(ids);
      try {
        return await store.transact(userKey, operation ? hash('operation', `${userKey}\0${operation}`) : null, keys,
          (account, savedOperation, entries, paid={limit:0,used:0,remaining:0}) => {
            unavailable(Array.isArray(entries) && entries.length === keys.length);
            for (const entry of entries) unavailable(entry === null || exact(entry, ['schemaVersion', 'registeredAtMs'])
              && entry.schemaVersion === 1 && integer(entry.registeredAtMs));
            return reduce(accountState(account), savedOperation, entries, keys,paid);
          });
      } catch (error) {
        if (error instanceof StudyError) throw error;
        throw new StudyError('import_ledger_unavailable', 503, 'Your import allowance could not be verified. Saved records remain available.');
      }
    }
    return {
      snapshot: () => transaction(null, [], (account,_saved,_entries,_keys,paid) => ({result: snapshot(account,paid)})),
      async register(input) {
        requireStudy(exact(input, ['operationId', 'videoIds']) && typeof input.operationId === 'string'
          && /^[A-Za-z0-9_-]{1,128}$/.test(input.operationId), 'invalid_import_registration', 400);
        const ids = videoIds(input.videoIds);
        return transaction(input.operationId, ids, (account, saved, entries, keys,paid) => {
          const digest = hash('input', [...keys].sort().join('\0'));
          if (saved !== null) {
            unavailable(exact(saved, ['schemaVersion', 'inputDigest', 'added', 'createdAtMs']) && saved.schemaVersion === 1
              && HASH.test(saved.inputDigest) && integer(saved.added) && saved.added <= 100 && integer(saved.createdAtMs));
            requireStudy(saved.inputDigest === digest, 'import_operation_conflict', 409, 'This import request already refers to other videos.');
            unavailable(entries.every(Boolean) && balance(account,paid).used >= saved.added);
            return {result: {operationId: input.operationId, videoIds: ids, added: saved.added, imports: balance(account,paid)}};
          }
          const added = entries.filter(value => value === null).length;
          requireStudy(added <= FREE_IMPORTS-account.usedImports+paid.remaining, 'import_allowance_exhausted', 402,
            'This selection exceeds your remaining history allowance. Choose fewer videos or check Starter Pack availability in the Learning lab. Saved records remain available.');
          const time = now(); unavailable(integer(time));
          const freeAdded=Math.min(added,FREE_IMPORTS-account.usedImports),paidAdded=added-freeAdded;
          const updated = {...account, usedImports: account.usedImports+freeAdded, updatedAtMs: time};
          return {paidImports:paidAdded,account: updated, operation: {schemaVersion: 1, inputDigest: digest, added, createdAtMs: time},
            registrations: keys.flatMap((key, i) => entries[i] === null ? [[key, {schemaVersion: 1, registeredAtMs: time}]] : []),
            result: {operationId: input.operationId, videoIds: ids, added, imports: balance(updated,{...paid,used:paid.used+paidAdded,remaining:paid.remaining-paidAdded})}};
        });
      },
      async assertRegistered(input) {
        const ids = videoIds(input);
        return transaction(null, ids, (account, _operation, entries,_keys,paid) => {
          requireStudy(entries.every(Boolean), 'import_registration_required', 403,
            'Register these videos with your Delta account before AI map analysis. Saved records remain available.');
          return {result: {imports: balance(account,paid)}};
        });
      },
    };
  }
  return {forUser};
}

export function createFirestoreEntitlementStore(firestore,{paidEnabled=false}={}) {
  unavailable(typeof firestore?.collection === 'function' && typeof firestore?.runTransaction === 'function');
  return {
    async transact(userKey, operationKey, videoKeys, reduce) {
      unavailable(HASH.test(userKey) && (operationKey === null || HASH.test(operationKey)) && Array.isArray(videoKeys)
        && videoKeys.length <= 100 && videoKeys.every(key => HASH.test(key)) && new Set(videoKeys).size === videoKeys.length);
      const accountRef = firestore.collection('studyImportEntitlements').doc(userKey);
      const operationRef = operationKey ? accountRef.collection('operations').doc(operationKey) : null;
      const videoRefs = videoKeys.map(key => accountRef.collection('videos').doc(key));
      return firestore.runTransaction(async tx => {
        const refs = [accountRef, ...(operationRef ? [operationRef] : []), ...videoRefs];
        const documents = await tx.getAll(...refs);
        const value = doc => doc.exists ? doc.data() : null;
        const offset = operationRef ? 2 : 1;
        let paidOrders=[];
        if(paidEnabled){const reader={read:async paths=>paths.length?(await tx.getAll(...paths.map(p=>firestore.doc(p)))).map(value):[]};
          paidOrders=(await readWalletOrders(reader,userKey)).orders;}
        const paidBalance=importPaidBalance(paidOrders);
        const paid=paidBalance;
        const update = await reduce(value(documents[0]), operationRef ? value(documents[1]) : null,
          documents.slice(offset).map(value), paid);
        for(const order of consumePaidImports(paidOrders,update.paidImports||0))tx.set(firestore.doc(orderPath(order.id)),order);
        if (update.account) tx.set(accountRef, update.account);
        if (update.operation) tx.set(operationRef, update.operation);
        for (const [key, entry] of update.registrations || []) tx.set(accountRef.collection('videos').doc(key), entry);
        return update.result;
      });
    },
  };
}

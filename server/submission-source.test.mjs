import test from 'node:test';
import assert from 'node:assert/strict';
import {allowSource,scanPublic} from '../tools/submission/prepare-source.mjs';

test('public store package admits reviewed assets but excludes private captures and arbitrary additions',()=>{
  for(const path of ['docs/submission/reviewer-instructions.md','docs/submission/payments.md','docs/submission/store-assets/icon-128.png','docs/submission/store-assets/promo-440x280.png','docs/submission/store-assets/screenshot-recall-1280x800.png'])assert.equal(allowSource(path),true,path);
  for(const path of ['docs/submission/store-assets/private-history.png','artifacts/competition/stripe-activation.jpg','.env.local','docs/internal-plan.md','docs/submission/store-assets/../private.png'])assert.equal(allowSource(path),false,path);
});

test('source preparation rejects populated Stripe keys without including their value in diagnostics',()=>{
  for(const prefix of ['rk_live_','rk_test_','sk_live_','sk_test_','whsec_']){
    const credential=prefix+'SYNTHETIC'.repeat(5);
    assert.throws(()=>scanPublic('server/fixture.mjs',Buffer.from(`value=${credential}`)),error=>error.message.includes('rejected Stripe credential')&&!error.message.includes(credential));
  }
  assert.doesNotThrow(()=>scanPublic('server/example.mjs',Buffer.from('DELTA_STRIPE_RESTRICTED_KEY=\nDELTA_STRIPE_WEBHOOK_SECRET=\n')));
});

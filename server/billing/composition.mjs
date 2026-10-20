import {createBillingStore} from './store.mjs';
import {createPaidUsage} from './usage.mjs';
import {createPurchaseLedger} from './ledger.mjs';
import {createStripeProvider,stripeSandboxConfig} from './stripe.mjs';
import {PROJECT_BUDGET_ENFORCED} from '../study/project-budget.mjs';
import {createStarterPackService} from './service.mjs';

// Missing payment configuration closes new sales, not sign-in or saved work.
// Purchased entitlements remain readable independently of Stripe availability.
export function attachStudyBilling(accounts,{firestore,key,env,now=Date.now}){
  if(accounts[PROJECT_BUDGET_ENFORCED]!==true)return accounts;
  const store=createBillingStore(firestore);
  accounts.paidUsage=createPaidUsage({store,key,now});
  try{
    const config=stripeSandboxConfig(env);
    if(config)accounts.billing=createStarterPackService({testUids:config.testUids,salesPaused:config.salesPaused,ledger:createPurchaseLedger({store,key,merchantId:config.merchantId,now}),provider:createStripeProvider(config)});
  }catch{accounts.billing=null;}
  return accounts;
}

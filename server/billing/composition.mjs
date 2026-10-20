import {createBillingStore} from './store.mjs';
import {createPaidUsage} from './usage.mjs';
import {createPurchaseLedger} from './ledger.mjs';
import {createStripeProvider,stripeConfig} from './stripe.mjs';
import {PROJECT_BUDGET_ENFORCED} from '../study/project-budget.mjs';
import {createStarterPackService} from './service.mjs';
import {createBillingGateway} from './gateway.mjs';

// Missing payment configuration closes new sales, not sign-in or saved work.
// Purchased entitlements remain readable independently of Stripe availability.
export function attachStudyBilling(accounts,{firestore,key,env,now=Date.now}){
  if(accounts[PROJECT_BUDGET_ENFORCED]!==true)return accounts;
  const store=createBillingStore(firestore);
  accounts.paidUsage=createPaidUsage({store,key,now});
  function entry(prefix){
    try{
      const config=stripeConfig(env,{prefix});if(!config)return null;
      const ledger=createPurchaseLedger({store,key,merchantId:config.merchantId,livemode:config.livemode,now}),provider=createStripeProvider(config);
      return {ledger,provider,service:createStarterPackService({testUids:config.testUids,salesPaused:config.salesPaused,ledger,provider})};
    }catch{return null;}
  }
  const current=entry('DELTA_STRIPE'),legacy=entry('DELTA_STRIPE_LEGACY');
  try{accounts.billing=current||legacy?createBillingGateway({store,key,current,legacy:legacy?[legacy]:[]}):null;}
  catch{accounts.billing=null;}
  return accounts;
}

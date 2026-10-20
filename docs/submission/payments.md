# Starter Pack payment contract

The Starter Pack is a **one-time US$5 purchase**, with 100 additional distinct-video imports and 20 bounded learning sessions. It is not a subscription or an unrestricted dollar balance. Each successful session covers up to five minutes of supplied captions, four teaching cards, two application exercises, up to two distinct follow-up answers and PPTX export. Website and extension libraries remain separate.

## Current availability

The account screen is authoritative about availability and labels **Sandbox** or **live**. Code supporting live mode is not proof that a merchant has been activated or a real payment has passed qualification. Sandbox purchases remain restricted to approved test accounts, even when a live merchant is configured. No test payment is treated as a real payment.

**Qualification status, 20 October 2026:** the isolated payment patch is source-tested and packaged, and the public pilot download is 0.7.3. The account holder completed the new merchant's Dashboard activation. Runtime credentials and real-provider payment/event qualification remain pending; the payment patch has not been promoted to the hosted backend. Dashboard activation alone does not establish API charging/payout readiness, live sales or Chrome Web Store distribution.

## Payment and delivery

1. Firebase verifies the signed-in account before Checkout or purchase-status access. The server owns the USD500-cent amount, product, quantity, order and user binding.
2. Stripe Checkout authorizes a card. The backend reserves bounded delivery capacity against the shared project budget before capturing exactly US$5. If capacity is unavailable, it attempts to cancel the authorization; it does not silently increase the project budget.
3. A signed webhook or an authenticated status check reads canonical Stripe state before granting allowance. The return URL alone grants nothing. Repeated events and requests cannot create another grant.
4. A purchase permanently retains its merchant and Sandbox/live mode. An explicit continuation resumes that original checkout; it cannot redirect an old request to another merchant. Refunds or disputes suspend unused allowance. Already saved work remains on the device.
5. Successful paid generation uses one session. Failed generation restores its session unit, while actual or conservatively reserved provider cost remains accounted for. Encrypted paid-result recovery is tied to the original account and retained beyond seven days, without promising indefinite storage or cross-device synchronization.

## Operator configuration

Keep credentials in server-side secret storage, never in the extension, browser, source repository or screenshots. Configure an explicit account with mode-matched restricted keys:

| Setting | Purpose |
| --- | --- |
| `DELTA_STRIPE_ENABLED` | `sandbox` or `live`; unset closes new sales |
| `DELTA_STRIPE_ACCOUNT_ID` | Exact intended merchant ID |
| `DELTA_STRIPE_RESTRICTED_KEY` | Server-only `rk_test_` or `rk_live_` credential matching the mode |
| `DELTA_STRIPE_WEBHOOK_SECRET` | Secret of that account and mode's signed endpoint |
| `DELTA_STRIPE_TEST_UIDS` | Required bounded allowlist for Sandbox; never a live-access bypass |
| `DELTA_STRIPE_SALES_PAUSED` | Stops new sales while keeping existing reconciliation and delivery |

When switching merchants, retain the original configuration under the corresponding `DELTA_STRIPE_LEGACY_*` names until its in-flight orders are resolved. The legacy configuration is for existing purchases, not another public storefront. Keep the existing HMAC/signing key, account IDs and paid-delivery storage stable. Missing payment configuration must not disable sign-in or existing purchased allowance.

An additional `DELTA_STRIPE_VERIFICATION_*` configuration can retain the new merchant's Sandbox receipts after the live cutover. It accepts Sandbox only and never provides a second storefront. The gateway permits at most three distinct account/mode targets, each with its own signing secret. Do not configure the same target as both current and retained: duplicate targets fail closed. During Sandbox qualification, use it as current; move its configuration to `VERIFICATION` in the same update that makes the live merchant current.

The signed endpoint is `/api/billing/stripe-webhook`. Subscribe only to the Checkout, PaymentIntent, refund and dispute events handled in `server/billing/service.mjs`; each account/mode has its own endpoint secret. Live Checkout/capture requires the exact account and mode plus `charges_enabled` and `payouts_enabled`. Never reuse another product's key merely because it shares a legal entity.

Before enabling live sales, qualify the exact deployed revision, activated merchant, restricted-key permissions, signed-event delivery, canonical capture, one-time grant, unauthorized access, return/resume behavior and paid-result recovery. Separate real-provider evidence from deterministic local tests. See [Stripe's webhook guidance](https://docs.stripe.com/webhooks), [manual capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) and [multiple-account guidance](https://docs.stripe.com/get-started/account/multiple-accounts).

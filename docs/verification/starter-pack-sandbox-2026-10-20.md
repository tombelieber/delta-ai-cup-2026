# Starter Pack Sandbox qualification — 20 October 2026

The USD5 Starter Pack is deployed for the approved Google test-account allowlist in **vic-ai-mvp Sandbox**. This is a test-payment release; live payments and unrestricted public purchases are not enabled. Public users retain the free allowance and saved-content paths.

## Exact candidate

- Implementation commit: `a2670a9`; matching public source: `ff7f186`.
- Cloud Run revision: `delta-assistant-starter-test-a267`.
- Registry image digest: `sha256:a1c05266af9adea0bb1d111fdc807b0c4848ed46640b0832506a6d88126cd2bb`.
- MV3 ZIP: 1,909,792 bytes; SHA256 `19e6b4a242c7a30c5e20631f3fe322d2b3362cafb96c2b5b1ad01f3e5d8d4b74`.
- 424 server tests, 310 extension tests and nine packaging tests passed on Node 24.18.0. The exact isolated container smoke passed with network disabled. Web and MV3 builds passed.

The existing Google authentication, Gemini model/key references, stable signing secret, USD10 project budget, scale-to-zero settings and resource limits were preserved. Stripe credentials use pinned Secret Manager versions with access granted to the existing runtime service account. Secret values and test-user identifiers are excluded from this report and source.

## Observed normal user path

| Check | Result |
| --- | --- |
| Google sign-in and existing library | The approved personal test account signed in through the normal popup flow. Four existing lessons remained readable after deployment. |
| Free imports | The account initially showed 10 of 10 imports left. |
| Cancel Checkout | Returning without payment added no entitlement; the same unpaid order could be resumed. |
| Declined test card | Stripe reported `generic_decline`, unpaid status and zero received. The order remained ungranted with no capacity reservation. |
| Successful test payment | Hosted Checkout displayed Sandbox and USD5. Stripe confirmed a completed, paid session and a manually captured PaymentIntent with 500 cents received. |
| Signed fulfillment | Canonical webhook requests from Stripe returned HTTP200. The account received +100 imports and +20 sessions before any manual purchase check. |
| Duplicate checks | Repeated **Check this purchase** kept the same single grant, 110 total imports and 20 sessions. |
| Paid learning | A real Gemini SUMIF lesson consumed exactly one session, leaving 19. An application exercise matched its AI-authored key; one follow-up returned a source-span link. The separate free AI allowance did not decrease. |
| Cost | The paid lesson plus one follow-up recorded a conservative API estimate of USD0.017054, below the USD0.10 session limit. This is an estimate using configured rates, not a billing invoice. |
| Paid recovery | The completed paid session and its recovery document existed in Firestore; no lesson or answer token was included in the evidence report. |
| Export transport | The normal authenticated UI prepared a PPTX and completed an HTTP200 transfer of 101,330 bytes with the expected presentation MIME type. |

After generation and follow-up, the order showed one used session, no held session, no pending session cost reservation and one completed follow-up. Paid-result recovery and the zero-free-credit path also have deterministic integration coverage; this run did not exhaust the real account's free credit or deliberately interrupt an in-flight generation.

## Safety and bounded recovery

Anonymous session and entitlement requests returned HTTP401. Unsigned webhooks returned HTTP400; the configured signing-secret contract accepted a signed non-business test event. The temporary revision hostname retained the Study API origin guard. Synthetic tests cover unauthorized Sandbox users, duplicate and reordered events, ownership checks, capacity exhaustion, refund/dispute handling and reserve-before-capture.

A real recovery check routed the canonical service to the same payment-capable image with new sales paused. New checkout controls disappeared, the existing paid order remained checkable, and its 19-session balance survived reconciliation. Traffic was then restored to the enabled Sandbox revision and temporary test tags were removed. Disabling Stripe composition or reverting to a pre-payment image is not the recovery path for an in-flight purchase.

## Explicit limits

The browser-control tool cannot retrieve native Blob downloads. This run verifies the export UI and completed binary transport; an OS-level saved-file/open test remains unqualified. Deterministic export tests produce and inspect real ZIP/PPTX files.

This receipt does not qualify a Chrome Web Store listing, live-money sales, arbitrary-account Sandbox purchases, long-term operational reliability, model accuracy or learning effectiveness. Public distribution remains the unpacked Chrome pilot. The live payment path requires a separately authorized live-mode implementation and qualification.

Product entry: [Delta onboarding](https://delta-511903.web.app/). Runtime setup: [Starter Pack setup](../starter-pack-setup.md).

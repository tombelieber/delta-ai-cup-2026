# Delta launch status — 21 October 2026

Dates use Asia/Hong_Kong. This page supersedes older availability snapshots; historical tests remain evidence only for their stated candidate and scope.

| Surface | Verified state |
| --- | --- |
| Public entry | [Firebase onboarding](https://delta-511903.web.app/) and [learning website](https://delta-assistant-613646062582.us-central1.run.app/learn?study=1) are available. Both Firebase Hosting domains link to the canonical support page. |
| Runtime | Cloud Run `delta-assistant-support-a064ba8`, 100% traffic, image `sha256:1793f91f5614b6e0b534d801608d58d57cdb4531b2784629f9bc43bd0222d049`. Public source candidate `a48cd33` corresponds to private candidate `a064ba8`. |
| Support and privacy | [Help](https://delta-assistant-613646062582.us-central1.run.app/support.html) and [privacy notice](https://delta-assistant-613646062582.us-central1.run.app/privacy.html) publish [info@vickyai.io](mailto:info@vickyai.io). The operator adopted this address and confirmed receipt; Chrome Web Store contact verification is separate. |
| Payment | The storefront uses Delta's independent LIVE merchant. Actual Sandbox cancellation, decline, capture, once-only grant and refund withdrawal passed. An actual LIVE expiration event returned HTTP200; no real-card payment was used. Actual LIVE capture and paid fulfilment remain unobserved. See the [payment contract and evidence](payments.md). |
| Distribution | Downloadable Chrome 0.7.3 remains an unpacked pilot, not a published/signed Chrome Web Store listing. Publisher/contact verification, dashboard completion, submission, Google review and store installation remain pending. |

## Release checks and compatibility

- **818 tests passed**, zero failed/skipped: 479 server, 310 extension, 15 website and 14 package checks. Frozen Web/MV3 builds and the non-root, network-disabled exact-image smoke passed without provider calls.
- Compared 132 actual application/release files with the previously qualified payment image. Only `dist/support.html` and `dist/privacy.html` changed. Payment, authentication, learning, quota and extension executables remain byte-identical. The 0.7.3 ZIP remains 1,917,583 bytes / 12 files, SHA256 `afdad40573e91ba62d67bebd9ea49b76af923179497cd9477c79c5faa48888fb`.
- Both changed pages were verified byte-for-byte on the candidate hostname and canonical public hostname. Canonical auth configuration returned HTTP200; anonymous entitlement access returned HTTP401 and unsigned payment events HTTP400. Preview Study access remains closed by the canonical-origin guard.
- The runtime principal, all environment/secret references, three payment targets, Google/Firebase configuration, Gemini route, existing ledgers, project cap and infrastructure sizing were preserved. No new lesson, history import, real payment or billing change occurred for this contact update.
- Previous native-caption learning and actual seven-slide PPTX save/open evidence remain applicable to the unchanged application files. They establish supported cases, not every YouTube video, future uptime, model accuracy or learning effectiveness.

## Operating limits

Ordinary accounts retain up to US$0.50 lifetime estimated AI allowance, ten distinct-video imports and a strict session estimate below US$0.10. The shared US$10 experiment cap remains enforced. A one-time US$5 pack adds 100 imports and 20 bounded sessions; shared delivery capacity can stop sales or new generation without deleting saved work. Never use test cards in LIVE Checkout or a real card for a payment test. Use an allowed Sandbox workflow and official Stripe test cards.

Viewing records and website/extension libraries remain local and separate. Optional map grouping classifies selected metadata; it is not evidence that all imported videos have full-text content indexed. Recall uses owned saved sources supplied by the current client. Firestore holds numeric identity/allowance/payment accounting and a separate encrypted paid-result recovery collection; it is not general cloud-library synchronization.

Three Google Cloud uptime checks and an enabled alert policy are configured for public onboarding, learning and auth configuration. Fresh read-only samples returned eight regional series, all passing. Complete regional coverage is not established by that bounded sample. These checks do not sign in or qualify authenticated learning/payment flows. Actual incident-email receipt remains unqualified; missing product telemetry is unknown, not zero. No outage or new tracking was introduced to manufacture evidence.

## Remaining owner and external steps

Chrome Web Store registration/contact/legal steps may require the account holder; Google approval and a genuine signed-store installation are external qualification steps. Automatic browser control rejected opening the publisher console during this run. The operator subsequently reported creating a developer account and supplied the Trader/Non-Trader declaration screen; trader/contact verification and listing creation remain pending. Prepared [listing copy/assets](store-listing.md) and [reviewer instructions](reviewer-instructions.md) are available.

A legitimate customer purchase is the opportunity to observe actual LIVE capture and once-only fulfilment. The agent did not manufacture a sale, self-charge or automatic refund. This pending observation must not be represented as a completed real-money payment test.

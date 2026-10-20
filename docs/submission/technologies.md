# Delta technologies

**Current release, 21 October 2026:** [launch status and exact deployed candidate](launch-status.md). Public support/privacy contact: [info@vickyai.io](mailto:info@vickyai.io).

| Technology | Actual role |
| --- | --- |
| Firebase Hosting; React / React DOM 19.3.1; Vite 7.2.4; Chrome MV3 | Static onboarding, bundled website/sidebar UI, local viewing/learning records and bounded visible-caption handoff. No remote executable code is loaded into the extension. |
| Firebase Web SDK 13.0.0; Firebase Admin 14.5.0 | Google sign-in on the website and server verification of identity/provider/email/revocation claims. Browser libraries and owned capabilities are scoped to the verified account. |
| Node.js 24; Cloud Run; Firestore | Server APIs, canonical-origin/source/ownership gates, shared US$10 and per-account numeric ledgers, import/payment accounting and a separate encrypted paid-result recovery collection. Browser learning libraries do not automatically sync across devices. |
| Gemini Developer API; `gemini-3.8-flash` | Bounded source-linked teaching, two application exercises, owned saved-source recall and requested metadata classification. The existing project/key/model and conservative cost guards remain unchanged. |
| Stripe SDK 23.0.0; PptxGenJS 4.0.1; Node crypto | Hosted one-time US$5 Checkout, signed raw-byte events, reserve-before-capture and once-only entitlements; editable seven-slide exports; account-bound encrypted capabilities/recovery. Actual Sandbox flow is qualified; LIVE configuration and expiry delivery do not prove live capture. |

Cloud Run retains scale-to-zero, maximum one instance, one CPU, 512 MiB and concurrency eight. These settings and free service allowances support the low-cost pilot target; they are not a guarantee of a future monthly bill. The same KOL Gemini route remains in use. No File Search, Memory Bank or new paid cloud product was enabled for this release.

[Architecture](architecture.md) describes data flow. [Performance](performance.md) retains its original workloads, attempts and limits; tests and exercise-key matches are not model accuracy or learning-effectiveness measurements. [Payment evidence](payments.md) separates Sandbox results from actual LIVE settlement.

<details>
<summary>Historical public source snapshot</summary>

The material below describes the earlier public snapshot; its deployment and availability statements are historical.

# Technologies

| Technology | Product responsibility |
| --- | --- |
| React, Vite, JavaScript | Website learning, practice, local library, source recall and map UI |
| Chrome Manifest V3 | YouTube observation, optional history import, native side panel and bounded hosted handoff; all executable extension code bundled |
| Node.js 24+, Google Cloud Run | Authentication enforcement, source parsing, bounded provider requests, credit reservation, capability ownership and exports |
| Firebase Hosting | Static installation/onboarding entry at https://delta-511903.web.app |
| Firebase Authentication / Admin SDK | Google-only website login, fresh ID-token verification and server-derived UID |
| Firestore | Server-only transactional numeric allowance/session/operation accounting; no cloud lesson/history library |
| Gemini Developer API | Existing pinned `gemini-3.8-flash` teaching, recall and selected-title/channel classification; no fallback/model change |
| PptxGenJS | Seven-slide editable teaching/practice/answer deck without another model request |
| Browser storage / AES-256-GCM | Endpoint-and-UID local library and private encrypted capabilities respectively |

Product source/dependency inputs come from locked snapshot `6f659082b5a155866bc64bc6dbe6853f9e54cfb6`. The example is paused and contains no credentials. Infrastructure and API estimates are separate costs. Model output, caption availability, installed extension behavior and regional availability need their own qualification.

</details>

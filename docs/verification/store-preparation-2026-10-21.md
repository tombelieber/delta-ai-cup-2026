# Chrome Web Store preparation — 21 October 2026

Dates use Asia/Hong_Kong. This is a preparation and public-policy release receipt, not a store submission or Google approval.

## Prepared handoff

The listing copy, precise permission reasons, privacy data-category choices, reviewer walkthrough and minimum image assets are ready in [submission materials](../submission/store-listing.md). Corporate verification details and the operator's original business documents remain local; they are not part of this public repository or the extension ZIP.

The exact archive is **0.7.3**, 12 files, 1,917,583 bytes, SHA256 `afdad40573e91ba62d67bebd9ea49b76af923179497cd9477c79c5faa48888fb`. Archive integrity, allowed paths, manifest contracts, packaged icon identity and all three PNG dimensions passed. Icon 128×128, small promotional image 440×280 and actual product screenshot 1280×800 match the [image requirements](https://developer.chrome.com/docs/webstore/images). No new package, model output, history import or payment was created for this preparation.

## Limited Use policy release

The public privacy notice now explicitly covers the [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use): disclosed feature use, restricted transfers, advertising/creditworthiness restrictions and permitted human-access exceptions. A business transfer requires explicit prior consent. Existing Gemini provider safety/retention disclosures remain visible.

- Runtime: `delta-assistant-privacy-f98a9f1`, canonical traffic 100%, no preview tags.
- Immutable image: `sha256:1d1144e19f11c827830fde916f5909ec5acf9cf68a46b8a2c5742568edd749fa`.
- Source candidate: public `d02386f`, corresponding private candidate `f98a9f1`.
- Final candidate input: `413a71a9a13103556757320ef361674efdd13046e7992c3051c79ecef6659246`.
- Exact privacy response SHA256: `b17378f6164754ec9aa6438d03f75f34c94ca4cc0d80ab3017bbafa844df1ea8`.

**818 deterministic tests passed**: 479 server, 310 extension, 15 website and 14 package, with zero failures/skips. The final static correction changed the policy hyperlink and explicit-consent wording only; unchanged executable-code test evidence was reused. The final frozen Web/MV3 image build and non-root, network-disabled image smoke passed. No Gemini provider calls were made.

A comparison of 132 application/release files with the qualified contact-update image found exactly one change: `dist/privacy.html`. Support, executable application files, dependencies and the downloadable extension are unchanged. Before staging and promotion, the current base, clean source, image identity and complete normalized runtime configuration were checked. Runtime identity, authentication, secret references, payment targets, quotas, budgets and infrastructure sizing were preserved.

The candidate first ran at zero canonical traffic. Its exact privacy/support bytes and ZIP passed, and preview Study routes remained denied by the canonical-origin guard. After promotion, the canonical privacy/support pages and learning entry returned HTTP200; auth configuration returned HTTP200 with authentication enabled; anonymous entitlements returned HTTP401; an unsigned webhook returned HTTP400 `invalid_payment_signature`. The unchanged 0.7.3 ZIP matched byte-for-byte. These are compatibility checks, not a new authenticated login, native-installation, AI-learning or paid-settlement test.

Firebase onboarding was separately sampled at HTTP200, with the qualified final demo link `XokomcChqWs`. Existing [native learning/PPTX evidence](native-extension-pptx-2026-10-20.md) and [payment evidence](../submission/payments.md) retain their original supported-case boundaries.

## Submission remains pending

The browser provider returned “The extensions gallery cannot be scripted” for the publisher console. No alternate interface was used to bypass this restriction. Email/SMS verification, truthful legal certification, dashboard upload and submission therefore remain manual; Google review and an actual signed-store installation remain unqualified.

Corporate country and service availability are separate. On 21 October, Google's [Gemini API region list](https://ai.google.dev/gemini-api/docs/available-regions) did not list Hong Kong. Its [terms](https://ai.google.dev/gemini-api/terms) also restrict API clients directed at, or likely to be accessed by, people under 18. Intended audience and distribution choices must be reconciled before submission; this release does not implement a new age/territory access gate or change the provider. Worldwide distribution is not qualified.

A real LIVE capture remains unobserved. No self-charge or test card in LIVE mode was used. Actual incident-email receipt also remains unqualified. Those boundaries are separate from this store-preparation work.

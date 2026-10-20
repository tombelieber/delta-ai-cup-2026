# Chrome Web Store submission — 21 October 2026

Dates use Asia/Hong_Kong. This supersedes the earlier [draft-only checkpoint](store-draft-2026-10-21.md). It proves receipt of a review submission, not approval, publication or installation from the signed store.

## Provider-visible outcome

- Item: `kdbehbeeeknnpalapjplhindhepagdoe`, Delta 0.7.3, under the verified VickyAI Limited organization/trader publisher. Contact `info@vickyai.io` is verified.
- The operator instructed completion and store onboarding after the three exact data-use certifications had been presented. All three were selected, saved and read back as checked; Google displayed **Item saved** and enabled submission.
- In the final confirmation, **Publish Delta automatically after it has passed review** was explicitly unchecked before submitting.
- Google confirmed **Your extension was submitted for review**. After dismissing the confirmation, the header displayed **Status: Pending review** and Status said **This draft is pending review**.
- Listing description, Education/English, demo, three image assets, permission/data disclosures, privacy/support/homepage links, reviewer summary and Contains in-app purchases were retained from the saved draft. Public/all-regions metadata was not changed; it remains unqualified for publication.

The final confirmation did not introduce a new fee, permission grant or additional contract-acceptance checkbox. Automatic publication remains disabled. Google review may take weeks; deferred items expire 30 days after approval if not published, according to the [official publishing guide](https://developer.chrome.com/docs/webstore/publish).

## Exact candidate and bounded checks

Submitted package: `Delta-Chrome-MVP-0.7.3.zip`, 12 files, 1,917,583 bytes, SHA256 `afdad40573e91ba62d67bebd9ea49b76af923179497cd9477c79c5faa48888fb`. No extension code, manifest, package, runtime configuration, provider model/key, billing or allowance setting changed for this submission.

A fresh anonymous sample of the canonical learning entry, auth configuration, support, privacy and linked ZIP returned HTTP200. The ZIP matched the qualified identity, manifest version, file count and archive integrity; support/privacy/learning/auth responses matched their previously observed content hashes. These checks do not establish a new authenticated learning or payment result.

The static store-ID check found no old unpacked-ID dependency. `extension/hosted-actions.js` passes the current runtime ID to the hosted learning URL; `src/learning/extension-bridge.mjs` consumes that validated ID. Sender checks bind the current ID, canonical website origin, exact tab and nonce. The backend receives the canonical website origin rather than a hard-coded extension origin. The exact ZIP contained no hard-coded 32-character extension-ID literal. **24 focused bridge tests passed**, zero failures/skips, using `node --test extension/hosted-actions.test.js server/study-extension-bridge.test.mjs`.

This is static/contract proof, not signed-store installation proof. A new store ID has separate local storage from the old unpacked ID; existing local records do not migrate automatically. Website sign-in does not synchronize those libraries.

## Before manual publication

Google approval, provider audience/territory qualification and an actual signed-store first-install check remain outstanding. The current [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [region list](https://ai.google.dev/gemini-api/docs/available-regions) do not qualify Hong Kong/worldwide client availability. Review can proceed with publication deferred; Google approval alone does not resolve that separate provider constraint. A later package/configuration change needs its own applicable qualification and review.

No new AI content, personal-history import, payment, account credit mutation, credential or production deployment was created for this submission. Corporate documents, private contact details, browser captures and verification links remain outside the public repository and extension package.

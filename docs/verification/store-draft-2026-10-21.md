# Chrome Web Store draft receipt — 21 October 2026

Dates use Asia/Hong_Kong. This records actual native dashboard setup and readback, not submission, approval or a signed-store installation. It supersedes the earlier scripting-only blocker in the [preparation report](store-preparation-2026-10-21.md).

## Verified dashboard state

| Area | Saved or observed result |
| --- | --- |
| Publisher | Organization/trader verification succeeded for VickyAI Limited; Settings showed a verified account. Corporate proof documents and identifiers remain outside this repository and package. |
| Contact | `info@vickyai.io` verified through Google's contact-email flow; Settings showed a verified email address. No verification link or token is retained here. |
| Item | Draft `kdbehbeeeknnpalapjplhindhepagdoe`; Status explicitly says the draft is unpublished. Package page shows draft version 0.7.3. |
| Store listing | Saved 2,311-character description, Education category, English language, canonical homepage/support links and final demo `https://www.youtube.com/watch?v=XokomcChqWs`; mature-content option off. |
| Assets | One 128×128 icon, one actual 1280×800 recall screenshot and one 440×280 promotional tile uploaded and read back after saving. The dashboard renumbered the sole screenshot label after save; no duplicate was uploaded. |
| Privacy | Single purpose, storage/sidebar/history/host permission reasons, No remote code and canonical privacy URL saved. PII, financial/payment, authentication, location, web history, user activity and website content selected. Health and personal communications not selected. |
| Reviewer access | Own eligible Google account; no shared username/password or purchase. A 421-character summary and full-instructions link saved in the 500-character field and read back after navigation. |
| Payment metadata | Contains in-app purchases saved, reflecting the optional US$5 pack. Installation and the free allowance do not require payment. |
| Distribution | Public visibility and all-regions defaults remain unchanged in the unpublished draft. They are not a qualified worldwide-release choice. |

The three formal data-use certifications remain unchecked pending explicit publisher confirmation: no sale/transfer outside approved use cases, no unrelated use/transfer, and no creditworthiness/lending use. They were not accepted merely to satisfy the dashboard.

## Exact package and asset checks

Uploaded ZIP: `Delta-Chrome-MVP-0.7.3.zip`, 12 files, 1,917,583 bytes, SHA256 `afdad40573e91ba62d67bebd9ea49b76af923179497cd9477c79c5faa48888fb`. The archive was not rebuilt or modified for the draft.

The promotional image required a no-alpha 24-bit PNG. Its previous RGBA alpha channel was entirely opaque (255); conversion to RGB preserved every decoded RGB pixel. Current SHA256: `21b8f5eb2ef3586f702bf156c63616b60f4bdab8d45e94867eb2dbd240e5f8e1`. Icon and product screenshot are unchanged. See [asset provenance](../submission/store-assets/README.md).

Only submission documentation and the pixel-equivalent promotional PNG changed in this repository update. Focused checks cover Markdown local-link targets, package hash/manifest/file count, asset dimensions/format and decoded pixel equality. The unchanged 818-test/runtime evidence remains attached to the prior exact policy candidate; no new runtime test or deployment is implied.

## Remaining publication boundaries

Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms) restrict API-client age and available regions. Hong Kong is absent from the [supported-region list](https://ai.google.dev/gemini-api/docs/available-regions) checked on 21 October. That page points to [Gemini Enterprise Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform) as a candidate for unlisted regions. Delta's eligibility, key/identity compatibility, usage accounting and costs on that different Cloud service have not been qualified. No provider, key, model, billing, runtime access gate or infrastructure setting was changed.

Store geographic settings alone do not restrict the public learning website; a mature-content rating is not an age-access gate. Audience and territory must be resolved before submission. The draft was not submitted or published. Google review and an actual signed-store installation remain external steps.

No new AI content, personal-history import, payment, allowance mutation or production deployment occurred for this draft setup. Provider verification and store metadata readback are separate from authenticated product end-to-end evidence and actual LIVE paid fulfilment.

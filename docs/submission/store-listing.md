# Delta Chrome Web Store preparation

**Status: 0.7.3 submitted to Chrome Web Store; `Pending review`, item `kdbehbeeeknnpalapjplhindhepagdoe`.** The organization/trader account and `info@vickyai.io` contact email are verified. Listing text, three image assets, permission/data disclosures, reviewer instructions, in-app-purchase classification and all three formal data-use certifications are saved. Automatic publication after review is disabled. Audience/territory qualification remains unresolved before publication; Google approval and signed-store installation have not occurred. See the [submission receipt](../verification/store-submission-2026-10-21.md).

Package baseline: `Delta-Chrome-MVP-0.7.3.zip`, 12 files, 1,917,583 bytes, SHA-256 `afdad40573e91ba62d67bebd9ea49b76af923179497cd9477c79c5faa48888fb`. The live pilot and source qualification are recorded in the [20 October hardening report](../verification/launch-hardening-2026-10-20.md). If a newer package is submitted, refresh this identity and repeat the applicable package/control-path checks first.

## Listing copy

| Field | Draft |
| --- | --- |
| Name | Delta |
| Short description | Learning help for supported knowledge videos. Revisit your viewing history, lessons and checked practice in a personal topic map. |
| Single purpose | Help users turn supported YouTube learning content into source-linked lessons, practice and a personal learning record. |
| Category | Education |
| Language | English |
| Homepage | `https://delta-511903.web.app/` |
| Privacy URL | `https://delta-assistant-613646062582.us-central1.run.app/privacy.html` |
| Support URL | `https://delta-assistant-613646062582.us-central1.run.app/support.html` |
| Support / privacy email | `info@vickyai.io` — verified in Chrome Web Store on 21 October 2026 |
| Price | Free installation; up to US$0.50 lifetime estimated AI allowance per verified account, subject to shared provider availability |
| Distribution → Payments | Contains in-app purchases: the optional US$5 Starter Pack; installation and the free allowance do not require a purchase |

Saved full description:

> From watching to remembering. Turn a learning video into something you can practise and revisit. Delta creates a short source-linked lesson, two application exercises and an editable PowerPoint you can keep. Ask follow-up questions using the saved sources you choose.
>
> The Chrome sidebar keeps local viewing records and optional imported YouTube history together in a personal topic map. Playback recording is enabled by default and can be turned off in Watching records & settings. Watching and importing are separate from checked practice: Delta does not claim that a video watched or an AI-authored answer key proves mastery.
>
> Sign in with Google on the learning website for an allowance of up to US$0.50 in estimated AI usage over the lifetime of your account. Each learning session has a separate budget below US$0.10. This is a limited allowance, not unlimited AI or a cash balance. Shared provider rate limits can temporarily pause requests.
>
> On a YouTube watch page, open Delta, choose Learning lab and then Learn current video. When YouTube makes a readable transcript available, Delta brings a caption excerpt of up to five minutes to the learning website. Prepared examples and matching caption-file input are also available. Captions can be unavailable; compatibility with every YouTube URL is not guaranteed. Website and extension libraries are separate and do not automatically sync between devices.
>
> Local viewing records are stored in this Chrome profile. Only content needed for an AI feature you request is sent for that feature. Google authentication and numeric allowance accounting use Firebase; AI generation uses the Gemini Developer API. Read the privacy notice before supplying captions, questions or explanation context.
>
> Ten distinct-video history imports are included per account for its lifetime. When available, the optional one-time US$5 Starter Pack adds 100 imports and 20 bounded learning sessions. The account screen identifies live or Sandbox mode; Sandbox is a test and does not charge real money. Payment is not required to try the free learning flow. Shared limits can pause new AI requests; saved lessons, checked practice and exports remain available.
>
> Delta is intended for adults aged 18 and over in regions supported by the Gemini API. It is not directed at children.

The dashboard contains the plain text without Markdown blockquotes. It was read back after saving; keep all scope and privacy disclosures when editing.

## Permission and remote-message justifications

| Manifest item | Purpose and boundary |
| --- | --- |
| `storage` | Keep local playback, optional imports, topic classifications, lessons, practice and settings. No cloud history synchronisation. |
| `sidePanel` | Display Delta's native Chrome sidebar next to YouTube. |
| `https://www.youtube.com/*` | Observe YouTube video metadata/playback and read explicitly confirmed history/transcript content for the visible user-facing features. Does not permit unrelated sites. |
| Optional `history` | The separate Chrome page-visit importer requests permission from the user's action, previews filtered YouTube links and imports only confirmed selections. Learning does not require it. |
| Optional hosted Delta origin | Call the exact hosted service when the user requests learning or topic analysis. |
| Optional `http://localhost/*` and `http://127.0.0.1/*` | Support the existing user-selected local development service setting. Access is requested only for the selected origin; the default production flow does not require it. |
| `externally_connectable.matches` | Only the exact hosted Delta website may request the supported data-only extension bridge. Validate sender origin and each message in the actual handler. No tokens, arbitrary URL fetching, executable code or general storage access belong in this bridge. |
| Remote code | No. All executable extension JavaScript is bundled in the uploaded package. The extension receives data responses and opens Delta's hosted learning website. Firebase sign-in executes on that separate website, not as remotely hosted extension code. |

The shipped manifest narrows optional hosts to the hosted Delta origin and loopback development hosts. It deliberately does not support arbitrary custom HTTPS service URLs. The settings UI must reflect this boundary; a rejected permission request must not be described as a supported custom backend.

## Data disclosures to reconcile before submission

The privacy form must reflect actual handling of browsing activity, website content, user-supplied learning context and Google sign-in. Local-only handling still requires disclosure. Do not select “no user data” because the viewing library is local. Firebase's identity records and a numeric hashed-identity credit ledger are separate from the locally saved learning library. Generated lessons/source context may also be present in the encrypted private runtime cache.

For the qualified 0.7.3 extension and its integrated hosted learning/payment flow, use the following handling disclosures. Google can change field labels; match the displayed definition as well as the name. These choices do not mean that every local record is transmitted.

| Dashboard data category | Selection and factual reason |
| --- | --- |
| Personally identifiable information | Select. Google sign-in processes account identity, email and display name. |
| Authentication information | Select. Firebase identity tokens and authenticated sessions are processed; Delta does not receive the Google password. |
| Financial and payment information | Select. The optional Stripe flow processes purchase references, payment state and entitlements. Stripe collects card details on hosted Checkout; Delta does not store card numbers. |
| Web history | Select. Local YouTube links, viewing records and optional selected history imports support the library and map. |
| User activity | Select. Observed playback times, ranges and status support the visible viewing record. |
| Website content | Select. Video titles, readable caption excerpts, source context and user-entered learning questions support requested learning features. |
| Location | Select for IP-address operational metadata handled by hosting/authentication providers. Delta does not request GPS or use a location-tracking feature. |
| Health information | Do not select for this release. Delta does not request health records or provide a health feature. Users are told to avoid sensitive AI inputs. |
| Personal communications | Do not select for this release. Delta does not access email, SMS or third-party private messages. Learning questions are disclosed under website/user-supplied content. |

Before accepting Google's data-use certifications, confirm that the exact submitted package and its providers still match the privacy notice. The notice contains an explicit Limited Use disclosure covering feature use, restricted transfers, advertising and human-access limits. No sale of user data, unrelated transfer or use for creditworthiness/lending decisions is permitted. This preparation is not a substitute for the publisher's truthful final certification.

The existing Gemini Cloud project was observed with active billing on 20 October 2026. Google's current Paid Services terms say prompts and responses are not used to improve its products; limited safety, abuse-prevention and legally required retention remains. Do not certify a no-human-access or no-retention statement. Recheck the actual data flow, active billing and current provider terms before store submission. Avoid sensitive, confidential or personal information in AI input. Google's terms still restrict age and API-client regions; worldwide store distribution is **not qualified** by this preparation. No billing or model setting was changed for this documentation correction.

## Artifact checklist

1. **Uploaded and saved:** [128×128 PNG icon](store-assets/icon-128.png), identical to the packaged icon. The ZIP also contains 16, 32 and 48 pixel versions. Manifest description is 129 characters, under the 132-character limit; `manifest.json` is at the ZIP root.
2. **Uploaded and saved:** [440×280 promotional image](store-assets/promo-440x280.png), using the existing Delta brand and theme. It is a 24-bit RGB PNG with no alpha, normalized without changing visible pixels. This is brand artwork, not a screenshot or functional proof.
3. **Uploaded and saved:** [1280×800 actual product screenshot](store-assets/screenshot-recall-1280x800.png). It crops and resizes the deployed, source-linked accounting recall capture; no interface, result or timestamp was invented. Its [provenance](store-assets/README.md) identifies the source. No private identity or personal viewing history appears.
4. **Saved and submitted:** [reviewer walkthrough](reviewer-instructions.md) in the dashboard's 500-character test field, linking to the full instructions. It uses the reviewer's own Google sign-in and does not require a purchase or maintainer credentials. Permission/data disclosures, the public privacy URL and all three formal certifications are saved.
5. **Still required:** Google review, supported audience/territory qualification before manual publication and actual signed-store installation. Public/all-regions metadata was not changed and is not a qualified worldwide release decision. The submitted item cannot publish automatically.

The [official image requirements](https://developer.chrome.com/docs/webstore/images), checked on 20 October 2026, require a 128×128 PNG icon, a 440×280 small promotional image and at least one 1280×800 or 640×400 full-bleed screenshot. All three minimum image types are now present; a marquee image is optional.

## Contact and publisher completion

The operator adopted `info@vickyai.io` for Delta support and privacy requests and confirmed they can receive mail there on 21 October 2026. Public support/privacy pages use this address. Chrome Web Store's separate contact-email verification subsequently completed successfully; the dashboard read back a verified email address. This does not prove incident-alert delivery or promise a support response SLA. Do not substitute a private test mailbox or another company's contact.

On 21 October 2026, the native dashboard showed successful organization/trader verification for VickyAI Limited and a verified account in Settings. The assigned draft item ID is `kdbehbeeeknnpalapjplhindhepagdoe`. Corporate proof documents, identifiers and verification links remain outside this repository and the uploaded ZIP. Google states that verified trader name, address and phone are publicly displayed; see the [official Trader FAQ](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq). Browser scripting could not operate the publisher console, but supported native Computer interaction completed the verified setup and draft upload. Google review and signed-store installation have not occurred. Changing an extension ID does not migrate the old unpacked installation's local learning records.

## Distribution and timing

Normal Windows and macOS users directly install Chrome Web Store-hosted and signed extensions. The ZIP remains a developer/test artifact requiring extraction and Developer mode's Load unpacked flow. Do not describe dragging a ZIP as a general public installation route. Do not modify enterprise policies or bypass Chrome security warnings.

Public, unlisted and private visibility all have the same policy requirements and review process. Unlisted means anyone with the store URL can install after publication; it is not a way around review. Google's guidance says most reviews complete within a few days, but reviews may take weeks. An immediate approval date is not guaranteed. This is an external dependency and must remain explicit in launch status.

**Region and age checks before publication:** business registration country is separate from service eligibility. Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms) restrict API-client availability to [supported regions](https://ai.google.dev/gemini-api/docs/available-regions) and prohibit clients directed at, or likely to be accessed by, people under 18. The official region list checked on 21 October 2026 does not include Hong Kong; do not publish Hong Kong or worldwide availability simply because the publisher is a Hong Kong company or the backend runs in the US. The item was sent for review with automatic publication disabled so the review queue can begin while intended audience/territory is resolved. Approval would not establish provider eligibility. This documentation does not change the provider, account, model, billing or runtime access controls.

The official region page points users in unlisted regions to [Gemini API in Gemini Enterprise Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform). This is a candidate Cloud route, not proof that Delta's current Developer API key, identity, billing, request contract or costs are compatible. Store geography alone cannot restrict the public learning website, and the mature-content checkbox is a content rating rather than an age-access gate. No provider migration or new runtime gate was made as part of saving this draft.

## Official references

- [Supported extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Publisher registration](https://developer.chrome.com/docs/webstore/register) and [account/contact verification](https://developer.chrome.com/docs/webstore/set-up-account)
- [Manifest and ZIP preparation](https://developer.chrome.com/docs/webstore/prepare) and [required listing images](https://developer.chrome.com/docs/webstore/images)
- [Privacy and permission fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [user-data policy FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Visibility settings](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution), [review process](https://developer.chrome.com/docs/webstore/review-process) and [Gemini API terms](https://ai.google.dev/gemini-api/terms)

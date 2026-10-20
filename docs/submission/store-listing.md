# Delta Chrome Web Store preparation

**Status: submission materials prepared for pilot 0.7.3; not submitted or published.** Publisher registration, verified contact, listing ID and Google review remain unverified. The qualified developer ZIP is not proof of a normal-user extension launch. The [reviewer instructions](reviewer-instructions.md) and [three required image assets](store-assets/README.md) are prepared below.

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
| Privacy URL | `https://delta-assistant-613646062582.us-central1.run.app/privacy.html` — deployed; operational request contact remains pending |
| Support URL | `https://delta-assistant-613646062582.us-central1.run.app/support.html` — deployed; operational support contact remains pending |
| Price | Free installation; up to US$0.50 lifetime estimated AI allowance per verified account, subject to shared provider availability |

Proposed full description:

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
> Ten distinct-video history imports are included per account for its lifetime. Optional Starter Pack checkout is currently Sandbox-only and does not charge real money. Payment is not required to try the free learning flow. Shared limits can pause new AI requests; saved lessons, checked practice and exports remain available.

Remove draft blockquotes when copying into the dashboard; keep all scope and privacy disclosures.

## Permission and remote-message justifications

| Manifest item | Purpose and boundary |
| --- | --- |
| `storage` | Keep local playback, optional imports, topic classifications, lessons, practice and settings. No cloud history synchronisation. |
| `sidePanel` | Display Delta's native Chrome sidebar next to YouTube. |
| `https://www.youtube.com/*` | Observe YouTube video metadata/playback and read explicitly confirmed history/transcript content for the visible user-facing features. Does not permit unrelated sites. |
| Optional `history` | The separate Chrome page-visit importer requests permission from the user's action, previews filtered YouTube links and imports only confirmed selections. Learning does not require it. |
| Optional hosted Delta origin | Call the exact hosted service when the user requests learning or topic analysis. |
| Optional `http://localhost/*` and `http://127.0.0.1/*` | Explicit local development services. A store submission should remove these if the published product no longer exposes local development settings. |
| `externally_connectable.matches` | Only the exact hosted Delta website may request the supported data-only extension bridge. Validate sender origin and each message in the actual handler. No tokens, arbitrary URL fetching, executable code or general storage access belong in this bridge. |
| Remote code | None in the extension. Executable JavaScript is bundled. Website Firebase sign-in runs on the website and does not load remote Firebase scripts into MV3. Verify the final packaged files before certifying this field. |

The shipped manifest narrows optional hosts to the hosted Delta origin and loopback development hosts. It deliberately does not support arbitrary custom HTTPS service URLs. The settings UI must reflect this boundary; a rejected permission request must not be described as a supported custom backend.

## Data disclosures to reconcile before submission

The privacy form must reflect actual handling of browsing activity, website content, user-supplied learning context and Google sign-in. Local-only handling still requires disclosure. Do not select “no user data” because the viewing library is local. Firebase's identity records and a numeric hashed-identity credit ledger are separate from the locally saved learning library. Generated lessons/source context may also be present in the encrypted private runtime cache.

The existing Gemini Cloud project was observed with active billing on 20 October 2026. Google's current Paid Services terms say prompts and responses are not used to improve its products; limited safety, abuse-prevention and legally required retention remains. Do not certify a no-human-access or no-retention statement. Recheck the actual data flow, active billing and current provider terms before store submission. Avoid sensitive, confidential or personal information in AI input. Google's terms still restrict age and API-client regions; worldwide store distribution is **not qualified** by this preparation. No billing or model setting was changed for this documentation correction.

## Artifact checklist

1. **Prepared:** [128×128 PNG icon](store-assets/icon-128.png), identical to the packaged icon. The ZIP also contains 16, 32 and 48 pixel versions. Manifest description is 129 characters, under the 132-character limit; `manifest.json` is at the ZIP root.
2. **Prepared:** [440×280 promotional image](store-assets/promo-440x280.png), using the existing Delta brand and theme. This is brand artwork, not a screenshot or functional proof.
3. **Prepared:** [1280×800 actual product screenshot](store-assets/screenshot-recall-1280x800.png). It crops and resizes the deployed, source-linked accounting recall capture; no interface, result or timestamp was invented. Its [provenance](store-assets/README.md) identifies the source. No private identity or personal viewing history appears.
4. **Prepared:** [reviewer walkthrough](reviewer-instructions.md), public privacy/support pages, qualified 0.7.3 package identity and deployed-flow evidence. The walkthrough uses the reviewer's own Google sign-in and does not require a purchase or maintainer credentials. Reconcile the privacy form with the exact final package before certifying it.
5. **Still required:** publisher/account verification, an operational public support/privacy contact, final dashboard fields and supported-region choice, submission, Google approval and actual signed-store installation. No claim of store publication is made by preparing these assets.

The [official image requirements](https://developer.chrome.com/docs/webstore/images), checked on 20 October 2026, require a 128×128 PNG icon, a 440×280 small promotional image and at least one 1280×800 or 640×400 full-bleed screenshot. All three minimum image types are now present; a marquee image is optional.

## Contact and publisher completion

The company website [VickyAI](https://www.vickyai.io/) publicly lists `info@vickyai.io` as a business contact. This is a **candidate only** for Delta: receipt, ongoing support handling and privacy-request handling have not been verified. Do not copy it into the listing as a confirmed operational channel until the operator adopts and checks it. Do not substitute a private test mailbox or an unrelated similarly named company's contact.

Publisher registration and dashboard access have not been established by these files. If the account requires registration payment, identity/contact verification or two-step verification, the account holder must complete those steps. Record the assigned listing ID after the dashboard creates it. Use the assigned public key only if aligning later unpacked development IDs; changing an extension ID does not migrate the old installation's local learning records.

## Distribution and timing

Normal Windows and macOS users directly install Chrome Web Store-hosted and signed extensions. The ZIP remains a developer/test artifact requiring extraction and Developer mode's Load unpacked flow. Do not describe dragging a ZIP as a general public installation route. Do not modify enterprise policies or bypass Chrome security warnings.

Public, unlisted and private visibility all have the same policy requirements and review process. Unlisted means anyone with the store URL can install after publication; it is not a way around review. Google's guidance says most reviews complete within a few days, but reviews may take weeks. An immediate approval date is not guaranteed. This is an external dependency and must remain explicit in launch status.

## Official references

- [Supported extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Publisher registration](https://developer.chrome.com/docs/webstore/register) and [account/contact verification](https://developer.chrome.com/docs/webstore/set-up-account)
- [Manifest and ZIP preparation](https://developer.chrome.com/docs/webstore/prepare) and [required listing images](https://developer.chrome.com/docs/webstore/images)
- [Privacy and permission fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [user-data policy FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Visibility settings](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution), [review process](https://developer.chrome.com/docs/webstore/review-process) and [Gemini API terms](https://ai.google.dev/gemini-api/terms)

# Delta Chrome Web Store preparation

**Status: draft preparation, not submitted or published.** No listing ID, registered publisher, verified support contact or review outcome has been verified. The developer ZIP is not proof of a normal-user extension launch.

## Listing copy

| Field | Draft |
| --- | --- |
| Name | Delta |
| Short description | Learning help for supported knowledge videos. Revisit your viewing history, lessons and checked practice in a personal topic map. |
| Single purpose | Help users turn supported YouTube learning content into source-linked lessons, practice and a personal learning record. |
| Category | Education |
| Language | English |
| Homepage | `https://delta-assistant-613646062582.us-central1.run.app/` |
| Privacy URL | `https://delta-assistant-613646062582.us-central1.run.app/privacy.html` — deployment must be verified |
| Support URL | `https://delta-assistant-613646062582.us-central1.run.app/support.html` — deployment and public contact must be verified |
| Price | Free installation; up to US$0.50 lifetime estimated AI allowance per verified account, subject to shared provider availability |

Proposed full description:

> Turn a learning video into something you can practise and revisit. Delta creates a short source-linked lesson, two application exercises and a PowerPoint you can keep. Ask follow-up questions using the saved sources you choose.
>
> The Chrome sidebar keeps local viewing records and optional imported YouTube history together in a personal topic map. Watching and importing are separate from checked practice: Delta does not claim that a video watched or an AI-authored answer key proves mastery.
>
> Sign in with Google on the learning website for an allowance of up to US$0.50 in estimated AI usage over the lifetime of your account. Each learning session has a separate budget below US$0.10. This is a limited allowance, not unlimited AI or a cash balance. Shared provider rate limits can temporarily pause requests.
>
> Learning requires usable timestamped captions. Listed experiments have prepared excerpts; other videos may need matching caption input. Availability for every YouTube URL is not guaranteed. Website and extension libraries are separate and do not automatically sync between devices.
>
> Local viewing records are stored in this Chrome profile. Only content needed for an AI feature you request is sent for that feature. Google authentication and numeric allowance accounting use Firebase; AI generation uses the Gemini Developer API. Read the privacy notice before supplying captions, questions or explanation context.

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

1. **Prepared:** manifest PNG icons at 16, 32, 48 and 128 pixels, copied into the unpacked build. Source vector: `extension/icons/delta.svg`. Manifest description is 129 characters, under the 132-character limit. Packaging must preserve `manifest.json` at the ZIP root.
2. **Prepared locally:** a 440×280 brand promotional image can be found in the ignored `artifacts/competition-store/` directory. It is not a screenshot or functional proof. Verify the final visual before upload.
3. **Still required:** at least one actual product screenshot at 1280×800 or 640×400. Use the qualified installed product and remove private identity/history. Never fabricate model results or imply unsupported functionality.
4. **Still required:** publisher registration status, verified contact email, public privacy/support URLs and an operational privacy request channel. No address or personal mailbox is invented by this draft.
5. **Still required:** final qualified ZIP/hash, deployed service proof, reviewer test instructions, policy checks, submission and actual approved store install proof. Supply reviewers their own sign-in flow; do not include owner tokens, passwords or private learning backups.

## Distribution and timing

Normal Windows and macOS users directly install Chrome Web Store-hosted and signed extensions. The ZIP remains a developer/test artifact requiring extraction and Developer mode's Load unpacked flow. Do not describe dragging a ZIP as a general public installation route. Do not modify enterprise policies or bypass Chrome security warnings.

Public, unlisted and private visibility all have the same policy requirements and review process. Unlisted means anyone with the store URL can install after publication; it is not a way around review. Google's guidance says most reviews complete within a few days, but reviews may take weeks. An immediate approval date is not guaranteed. This is an external dependency and must remain explicit in launch status.

## Official references

- [Supported extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Publisher registration](https://developer.chrome.com/docs/webstore/register) and [account/contact verification](https://developer.chrome.com/docs/webstore/set-up-account)
- [Manifest and ZIP preparation](https://developer.chrome.com/docs/webstore/prepare) and [required listing images](https://developer.chrome.com/docs/webstore/images)
- [Privacy and permission fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [user-data policy FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Visibility settings](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution), [review process](https://developer.chrome.com/docs/webstore/review-process) and [Gemini API terms](https://ai.google.dev/gemini-api/terms)

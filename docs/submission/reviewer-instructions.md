# Delta — Chrome Web Store reviewer instructions

Prepared for pilot **0.7.3**, 20 October 2026. These instructions describe the actual native-extension and hosted-learning path; they do not assert that a listing has been approved. No maintainer password, token, API key, private history or payment is required.

## Entry and account

Product homepage: <https://delta-511903.web.app/>. Learning website: <https://delta-assistant-613646062582.us-central1.run.app/learn?study=1>.

Use desktop Chrome 116 or later and the extension package supplied through the review dashboard. Open **Delta** from Chrome's extension menu or toolbar. Google sign-in takes place on the hosted learning website, not inside the native side panel. Use your own eligible Google account. Each verified account has up to US$0.50 lifetime estimated AI allowance; this is not a recurring credit or cash balance. The AI feature is subject to provider availability and supported regions.

Optional Chrome history permission and personal-history import are **not required** for the core test. Keep them declined unless you specifically want to review that separate, consent-based feature.

## Core review — one public teaching video

1. Open [Accounting Stuff — The CASH FLOW STATEMENT for BEGINNERS](https://www.youtube.com/watch?v=DiVPAjgmnj0). Expand YouTube's description, choose **Show transcript**, and check that timestamped caption text is visible. Opening that public video does not require importing personal history.
2. Open Delta's native side panel, select **Learning lab**, then **Learn current video →**. The learning website opens for the same video. Choose **Sign in with Google** there. A usable capture shows **Captions ready · 0:00–5:00**. This captures a bounded excerpt, not the full video or the account's full history.
3. Choose **Generate lesson** once. The website shows a source-linked explanation, four teaching slides, two application exercises and the conservative session-cost estimate. Follow a **Source caption span** link to inspect the original context. Generated wording can vary; the exact screenshot answer is not an expected fixed output.
4. Under **Practice**, select an answer and choose **Check my reasoning**. A matching key makes **Try the transfer exercise →** available. Under **Recall**, ask: “According to my saved cash flow lesson, how does accrual accounting record revenue differently from the cash method? Please cite the source.” Choose **Find it in my learning** and inspect the returned timestamp links. If evidence is insufficient, an explicit no-source answer is an allowed result; do not interpret it as a supported answer or a failed network request.
5. Choose **Download PPT + exercises**, then the ready **Save Delta-…pptx** link. Complete Chrome's Save dialog if shown and open the file in PowerPoint or Keynote. The export has seven slides, including practice and sources. Reload the learning tab: the saved lesson and checked practice should remain for the same signed-in user on that browser.

The generated exercises and keys are AI-authored. Matching a key verifies the practice interaction; it is not a mastery, financial-advice or exam-score assessment. The question above concerns the saved accounting source, not general search over every video watched.

## If captions or a service are unavailable

YouTube sometimes leaves its transcript panel loading or does not offer captions. Delta reports missing captions explicitly. Use a prepared example from **Video sources** on the signed-in learning page, or import a matching timestamped `.txt` caption file through **Use another teaching video**; a YouTube URL alone does not include captions. Do not count a prepared-source fallback as successful automatic capture.

Google sign-in can show a bounded connection error instead of waiting indefinitely. Check the popup and selected account, then use the available reconnect control if appropriate. Do not enter an API key into the browser or repeatedly generate lessons to diagnose an error. Shared provider limits or exhausted allowance can block new AI requests while saved learning and deterministic practice/export remain accessible. Re-preparing a PowerPoint does not require another AI lesson.

## Data, optional features and payment boundary

Playback records are saved locally while recording is on; **Watching records & settings → Record actual playback** turns future recording off. Optional history import previews the selected YouTube records and requires confirmation. Ten distinct-video import registrations are included per account for its lifetime. Website and extension libraries remain separate; Google sign-in does not automatically synchronize those libraries across devices.

**My map** groups selected video metadata. These title-based groups are not proof that the system has indexed full video content, that an imported video was watched in full, or that a skill was mastered. AI analysis is separately requested and can consume allowance.

No purchase is required for the core review above. The optional US$5 Starter Pack screen identifies LIVE or Sandbox mode; LIVE charges real money. Skip paid Checkout during review. Use official test cards only in an explicitly enabled Sandbox workflow, never in LIVE Checkout. Sandbox results do not establish real-money settlement readiness. Do not use a real card or maintainer account for the review.

Privacy: <https://delta-assistant-613646062582.us-central1.run.app/privacy.html>. Help: <https://delta-assistant-613646062582.us-central1.run.app/support.html>. Support and privacy requests: <info@vickyai.io>, adopted and receipt confirmed by the operator on 21 October 2026. Chrome Web Store's separate publisher/contact verification remains pending. Do not send account tokens, browser cookies, caption backups or private viewing records in a support request.

## Package and evidence

Baseline package: `Delta-Chrome-MVP-0.7.3.zip`, 1,917,583 bytes, SHA-256 `afdad40573e91ba62d67bebd9ea49b76af923179497cd9477c79c5faa48888fb`.

The [native verification](../verification/native-extension-pptx-2026-10-20.md) records the actual caption handoff, new accounting lesson, practice, source question and OS save/open. The [later hardening receipt](../verification/launch-hardening-2026-10-20.md) records bounded sign-in, canonical recall versions and the deployed public pilot. These are sampled verification results, not universal video compatibility or Google approval.

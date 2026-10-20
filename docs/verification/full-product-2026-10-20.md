# Delta product qualification — 20 October 2026 (Hong Kong)

Status: the public Sandbox pilot is available. This is not all-features or commercial-launch clearance. The later [Computer-native verification](native-extension-pptx-2026-10-20.md) completed side-panel → selected-video website → sign-in → saved lesson → actual PPTX save/open. Automatic YouTube caption capture, final installed-version reload and intermittent fresh sign-in reliability remain unqualified.

The later [UI readability release](ui-readability-2026-10-20.md) is the current website/ZIP distribution. The candidate below is the retained functional baseline, not the current image or ZIP.

## Exact candidate — functional baseline

- Implementation: `2b9a38e7638965161e10508305285ff0cc1261d6`; public source equivalent: `33e8e65`.
- Cloud Run: `delta-assistant-verify-final-2b9a`, 100% traffic, no test tags.
- Registry image: `sha256:2dd6655b10536b70ce5f3e8d6f9121ba938bbc0e009c05abeb90379a6f76605e`.
- MV3 ZIP: 0.7.0, 12 files, 1,910,117 bytes, SHA-256 `6a0e12e3192495f10968d1f3705016887837b53aecf5777f3bd9b2062e2289e6`.
- Runtime environment, secret references, service identity and resource configuration were preserved. Min instances 0; max instances 1. This is a cost configuration, not proof of a particular monthly invoice.

## Verification matrix

| Surface | Evidence | Result / limit |
| --- | --- | --- |
| Public entry | Onboarding, learning page and Map return 200; onboarding links the qualified `XokomcChqWs` demo | Available anonymously; protected functionality requires Google sign-in |
| Default free allowance | Public auth config reports US$0.50; server tests enforce 10 distinct lifetime imports, durable reservations and account ownership | Configuration and deterministic contract verified; the test actor is an existing account |
| Google sign-in | Two consecutive fresh signed-out tabs completed Google credential exchange, Delta session and entitlements with 200 | Recovered in the observed runs. Earlier popup closures and user-reported spinners occurred; their root cause was not established. No Firebase/OAuth setting was changed |
| Website Map import | Two public teaching-video metadata records admitted before local persistence; repeat import leaves the counter unchanged | Live authenticated control path passed; pre-existing local records retained |
| Website Map analysis | Admission and classification return 200; explicit Starter Pack allocation selected; free AI balance and learning-session count unchanged | Live selected-metadata classification passed |
| Map persistence/navigation | Reload preserves records and reviewed state; topic list renders 12 rows, expands to 24, resets to 12 on sort change; selected SUMIF record routes to its learning page | Live controls passed; no new personal history was imported for this check |
| Sandbox purchase | Actual hosted Checkout cancel, decline, successful test card, signed webhook grant and duplicate reconciliation | Passed in `vic-ai-mvp Sandbox`; see the linked payment report. Real-money payments remain disabled |
| Learning/practice | Existing four-topic real-AI results retained; an actual generated SUMIF exercise returns matching-key feedback through the deployed UI | Passed for these sources; answer-key agreement is not independent accuracy or learning-effectiveness evidence |
| Source recall | Live saved-source question returns 200 and two timestamped source links | Passed for the sampled question; selected source context is sent to Gemini |
| PPTX | Computer completed Chrome Save As, verified a 101,330-byte / seven-slide PPTX on disk, then opened it in Keynote | Native save/open passed; see the newer native report and rendered capture |
| Extension | Computer operated the native side panel and opened the correct selected-video website; the current 0.7.1 files were staged and verified | Native handoff passed with an explicit missing-captions fallback. Successful caption ingestion and final 0.7.1 reload remain unobserved |
| Anonymous and hostile access | Anonymous session/entitlements return 401; private environment/source paths return 404; cross-origin and invalid ownership/signature cases covered by container and server tests | Observed and deterministic boundary checks passed; not a claim of exhaustive penetration testing |

## Fixes shipped during verification

Website imports previously saved local records without registering their IDs with the account allowance. Analyze then hit the backend `import_registration_required` guard. Imports now register before local persistence; Analyze also admits older local records. A rejected selection preserves existing local records, and late responses cannot write into another account.

Website classification previously required free AI credit even when a purchased Map allocation was available. The explicit allowance selector now forwards the chosen funding source, fixed for the analysis run. Paid classification uses no learning session.

Metadata files remain bounded to 100 records per import. Accumulated storage uses the existing server entitlement ceiling (10 free plus at most 32 packs); every new import is still subject to the server's actual available balance. Topic rows now load in batches of 12, and the analysis disclosure reads its actual 10-video batch constant.

The previous test commands omitted the website Map adapter suite. `pnpm test` now includes server, extension, website and packaging tests.

## Measured samples and repeatable gates

| Measurement | Observed result | Scope |
| --- | --- | --- |
| Deterministic tests | 424 server + 310 extension + 15 Web Map + 9 packaging = 758 passed | Final code candidate; no skipped failures |
| Builds | Web and MV3 passed | Node 24.18.0; pinned dependencies |
| Isolated container | Non-root, read-only filesystem, no network/provider calls; private paths denied; four prepared sources and exact ZIP checked | Packaging/runtime compatibility; not Google E2E |
| Production dependency audit | No known vulnerabilities reported | Registry advisory snapshot on the verification date; not a zero-vulnerability guarantee |
| Two-video Map analysis | 3,150.821 ms request to response headers; US$0.002448 conservative API estimate | One batch, two public demo titles; not per-video attribution or a percentile |
| Saved-source recall | 3,535 ms request-to-transfer completion; two source links | One question, actual UI control path |
| Paid lesson session | UI conservative cumulative estimate US$0.0216 / US$0.10 | Includes its recorded generation/follow-up usage; not a provider invoice |
| Fresh login provider/session calls | Provider 419.898–476.102 ms; session 451.540–498.752 ms | Two successful final runs, excluding human account-selection time; earlier failures are not erased |
| Public login resources | Page 398 ms; auth config 310 ms | One sequential sample of each; not a cold-start or SLA benchmark |

The server inputs are byte-identical to the previously qualified payment candidate. Existing real Sandbox payment and four-topic generation receipts remain applicable; this run did not create another purchase just to repeat those results. The new UI and Map wiring were separately tested on the canonical live origin.

## Native verification follow-up — 20 October, 13:34 Hong Kong

This is retained historical evidence; its pending native steps are superseded where explicitly proved in the [later Computer-native report](native-extension-pptx-2026-10-20.md).

The historical unpacked installation folder did not match the published ZIP, even though both manifests said 0.7.0. Its old background omitted the import-admission dependency passed to both history handlers in the qualified source. This was functional package drift, not merely styling. The complete previous folder was backed up, the same folder path was retained, and all 12 replacement files were verified against ZIP SHA-256 `6a0e12e3192495f10968d1f3705016887837b53aecf5777f3bd9b2062e2289e6`. No Chrome profile, library, history, quota or account data was modified. The historical path is not itself proof of the path Chrome currently loads; native Reload and path confirmation are still pending.

A read-only source review found no deterministic PPTX Blob-link defect. Four focused offline contract checks passed for bearer-authenticated Blob bytes, ticket expiry/binary output, native caption handoff and the website nonce bridge. A successful transport or mocked contract remains distinct from an actual OS save/open. The signed-in existing SUMIF lesson exposed its ready Save link without another AI request. The user then explicitly reported successful download and opening. The default Downloads filename scan did not locate a new file, so native completion is recorded as user-assisted acceptance rather than independent automated file inspection; a historical demo artifact with the same filename was excluded from current evidence.

The learning suggestion is intentionally hidden for dismissed/enrolled videos (`extension/contextual-learning.js`); its absence on an already-used YouTube source is not sufficient evidence that the extension failed to load. The toolbar side-panel entry remains the required control for that case. The user confirmed that the reloaded native side panel opens, but the hosted learning handoff has not yet completed; the next control is Learning lab → Learn current video. Hosted lessons are saved in the website library; automatic synchronization back to the extension library is not implemented and must not be claimed.

## Remaining launch qualifications

1. Reproduce or resolve the reported intermittent Google spinner in the affected user's browser; two successful final runs establish recovery, not a proven root-cause fix.
2. Observe the final 0.7.1 reload and active path, then qualify actual YouTube caption capture. Native side-panel → website → sign-in → saved lesson → PPTX save/open is now proved, but the sampled transcript stayed on a YouTube spinner. Computer could operate native Chrome controls; its final manager observation timed out. Do not describe the browser-only control limitation as a blanket Computer prohibition.
3. Live billing and extension-store distribution are not enabled or qualified. Sandbox results must not be presented as real-money readiness or store approval.
4. Cloud Monitoring currently has no configured uptime checks or alert policies. The thread's sampled availability monitor is separate; full product telemetry is unqualified.

The bounded source-security review covered authentication, ownership, metering, import admission, Stripe reconciliation and untrusted-source/output boundaries. It recorded no confirmed exploitable finding in those reviewed paths, but coverage was partial: remaining legacy provider implementations and all test fixtures were not exhaustively reviewed. Do not describe it as a complete security audit.

References: [Sandbox payment qualification](starter-pack-sandbox-2026-10-20.md), [published performance report](../submission/performance.md), [Starter Pack setup](../starter-pack-setup.md).

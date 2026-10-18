# Setup and supported scope

## Install and verify

Use Node.js 24+ and pnpm 11.25.0. Run the install, tests and builds from the root README. Tests use synthetic identities/providers; they do not require Google sign-in or a live model. The dev dependency App Canvas is public maintainer tooling; its review scripts are outside this source package's supported product verification path.

Copy `.env.example` to ignored `.env.local`. Run `pnpm start` for the Node API, then `pnpm dev` separately. The API binds to `127.0.0.1:8787`; Vite proxies `/api` from `127.0.0.1:5173`. AI is paused and study is disabled in the example. Both builds work without credentials.

## Captions

No raw captions or original learner outputs are included. Four prepared server-private caption excerpts are deployment inputs, not public fixtures. A source requires an 11-character YouTube video ID and matching timestamped text with a `Video ID:` header. The parser validates identity and a clip no longer than five minutes. Pasting a URL alone does not fetch captions. The Chrome Learn path can capture an ordinary visible transcript; this does not guarantee availability for every video.

## Optional local study

Set `STUDY_ENABLED=true` and `STUDY_ACCESS_MODE=local` only after providing private signing and provider configuration. Keep HOST at `127.0.0.1`; local mode rejects non-loopback and cross-site traffic. Optional server-private sources use `STUDY_SOURCE_DIR`; private caches use `STUDY_CACHE_DIR`. Do not put either under public assets or Git.

The provider policy is deliberately pinned. A generic new key/project will not satisfy the existing deployment policy. Do not weaken these guards or copy an operator's credentials to make a fork run. Deployment/provider adaptation is a separate review, outside this snapshot.

## Hosted Google identity and quotas

Google mode requires `STUDY_ENABLED=true`, `STUDY_ACCESS_MODE=google`, an exact HTTPS `STUDY_ORIGIN`, matching `FIREBASE_PROJECT_ID` / public `FIREBASE_WEB_CONFIG`, Firebase Admin application-default credentials and a stable canonical 32-byte `LEARNING_SIGNING_KEY_BASE64`. Configure Google-only sign-in and the real website domain. The browser never receives Gemini, signing or service-account credentials. Firebase web configuration is public metadata.

The backend verifies issuer, audience, UID/subject, Google provider, verified email and token revocation. Direct browser access to the Firestore credit ledger must remain denied. Ordinary UID allowance is US$0.50 lifetime; estimated session reservations remain below US$0.10. Transactions reserve before generation, settle known usage and retain unknown dispatched failures. Account credit, session credit, provider quotas and invoice costs are different controls.

Paid-budget candidate code additionally requires explicit verified paid-route configuration and an administratively seeded fixed project ledger; missing or corrupt state fails closed. It does not activate billing, seed credit or infer automatically. Keep the example paused until exact identity, budget, input and deployment checks pass.

## Extension and onboarding

After `pnpm build:extension`, use Chrome 116+ Developer mode and Load unpacked to select `extension-dist/`. Start on a YouTube watch page. The default service origin is the public Delta backend. Website Google sign-in happens in a website tab; the external bridge binds exact origin, tab, action and expiring nonce and transfers no auth credentials. Website and extension libraries do not synchronize.

History import is optional. Native YouTube account history asks for confirmation of the visible account; Chrome browsing-history permission is separately optional. Playback recording is local and can be switched off. AI work sends selected captions/context or requested metadata; never submit credentials, confidential information or prohibited personal data.

Firebase Hosting onboarding source is in `onboarding/`. Screenshot media are deliberately excluded; the current approved images are on the deployed onboarding site. The root product build does not depend on those screenshots. Deploying onboarding is not deployment or qualification of the working backend. Do not redeploy a production Hosting site merely to inspect this source.

## Privacy and evidence

Browser libraries are endpoint-and-UID scoped. Firestore stores hashed identifiers and numeric accounting, not viewing history, captions or lessons. Private Node files contain sealed capabilities plus metadata/cost receipts. Authentication is session-persistent. Signing out hides the library; it is not deletion of local learning.

The public source includes no original Git history, private environments, account dump, raw caption file, runtime cache, learner backup, media or internal planning/automation. No license was supplied by the locked source. [Performance](performance.md) and [source audit](source-audit.md) retain historical limits; tests and key matches are not model accuracy or learner-effectiveness measurements.

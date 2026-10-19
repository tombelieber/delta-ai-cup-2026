# Delta

> **Latest source candidate:** ten free lifetime imports plus a US$5 Starter Pack Sandbox flow (+100 imports / +20 bounded learning sessions). Test sales are restricted to configured test accounts and disabled without runtime secrets. This source has **not been deployed or qualified through real app Checkout**. See [verification and UI evidence](docs/verification/starter-pack-payments.md) and [Sandbox setup](docs/starter-pack-setup.md).

**Learn it. Try it. Keep the evidence.** Delta turns a short captioned YouTube clip into a source-linked lesson, two application exercises, saved-source recall and an editable PowerPoint. A local topic map helps revisit video records.

- [Get started and install the Chrome pilot](https://delta-511903.web.app)
- [Open the learning website](https://delta-assistant-613646062582.us-central1.run.app/learn?study=1)
- [Watch the 170-second working demo](https://www.youtube.com/watch?v=XokomcChqWs) — My map visual walkthrough starts at 1:38.
- [Privacy](https://delta-assistant-613646062582.us-central1.run.app/privacy.html) · [Support](https://delta-assistant-613646062582.us-central1.run.app/support.html)

## Product and pilot scope

1. Install the unpacked Chrome pilot using the onboarding instructions, or use the website directly. This source does not assert Chrome Web Store approval or a one-click Store install.
2. Sign in with Google on the website. Ordinary accounts have **US$0.50 lifetime estimated AI allowance**, with a separate strict **less-than-US$0.10 estimated session allowance**. It is not a cash balance and does not reset daily.
3. Choose an available prepared excerpt or supply matching timestamped captions. The implemented extension Learn handoff reads ordinary visible YouTube transcript content; captions may be unavailable, and the installed handoff is not fully qualified by the source snapshot.
4. Request teaching, practise against an AI-authored key, ask about saved sources and export a seven-slide PPTX. Watching or matching a key does not prove mastery, factual accuracy or an exam score.
5. Website My map accepts local metadata and meters requested classifications. A model's high-confidence label is not calibrated accuracy. Website and extension libraries remain separate.

**Availability:** the operator may pause generation at the project budget or provider boundary. This source snapshot is not a guarantee of current live generation, provider region eligibility, universal YouTube support or installed-extension end-to-end qualification. Saved deterministic work and exports are designed to remain usable without further AI. Check the deployed UI for availability.

## Run the source

Node.js 24+ and pnpm 11.25.0 are required.

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm test:server
pnpm test:extension
pnpm build
pnpm build:extension
cp .env.example .env.local
pnpm start
```

In another terminal run `pnpm dev`, then open `http://127.0.0.1:5173`. The example intentionally disables AI and the study API. It contains no credentials or access to the hosted operator project. [Setup](docs/submission/setup.md) explains private configuration and source inputs.

## Google stack and evidence

Firebase Hosting serves onboarding; Cloud Run serves the React/Vite website and Node API. Firebase Authentication verifies Google identity, Firestore holds numeric credit accounting, and the Gemini Developer API generates bounded content. PptxGenJS creates editable exports. [Architecture](docs/submission/architecture.md), [technologies](docs/submission/technologies.md) and [performance evidence](docs/submission/performance.md) describe the wiring and evidence limits.

This public tree derives from source snapshot `6f659082b5a155866bc64bc6dbe6853f9e54cfb6` and starts with **new history**. It excludes original Git history, credentials, private agent/strategy materials, raw prepared captions, private viewing records, real account fixtures, runtime caches, learner capabilities, demo automation and media. Synthetic unit-test identities are artificial examples. Runtime brand icons are included; episode/demo screenshots are not redistributed. The onboarding HTML/CSS is included, while its approved screenshots remain on the live site and are not bundled.

The pinned `gemini-3.8-flash` model and provider policy are preserved. Deployment identifiers in code are policy identifiers, not API credentials. Free and paid provider modes require their respective verified operator configuration; the example enables neither. Provider terms, supported regions, age requirements, hosting costs and application estimates remain separate concerns.

No existing LICENSE file was present in the locked source. This snapshot does not invent an open-source license or grant third-party media rights.

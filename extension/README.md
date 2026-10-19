# Delta Chrome pilot

The current source is an unpacked MV3 developer pilot, not a Chrome Web Store listing. Build with `pnpm build:extension`; load the generated `extension-dist` folder containing `manifest.json` through Chrome's **Load unpacked** control. Reload the extension and refresh YouTube after rebuilding.

The default YouTube-account history import reads at most ten recent visible videos. Both native collectors register distinct IDs against the signed-in account before saving. A Sandbox Starter Pack candidate adds 100 lifetime import registrations and 20 bounded learning sessions; optional larger selections need sufficient server-verified allowance. Existing local data remains accessible when new admission is unavailable.

Google sign-in and paid actions run on the configured learning website. The website's library is separate from the extension's local history. The candidate has not completed real installed-extension / app Checkout qualification and does not enable live payments. See [Sandbox setup](../docs/starter-pack-setup.md), [verification and UI evidence](../docs/verification/starter-pack-payments.md), and the root README for supported captions, limits and deployment status.

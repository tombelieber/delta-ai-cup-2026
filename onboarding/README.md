# Static onboarding source

Public installation entry: https://delta-511903.web.app . The working website is https://delta-assistant-613646062582.us-central1.run.app .

The home page’s **Watch the demo** action scrolls to `#demo` and plays the [qualified product demo](https://www.youtube.com/watch?v=XokomcChqWs) in a lazy, privacy-enhanced YouTube iframe. The separate SUMIF teaching example remains an input video, not the product demonstration. CSP permits only `https://www.youtube-nocookie.com` as a frame origin on the landing paths; the origin referrer needed for playback is retained. This does contact Google when the player loads.

The installation action downloads `downloads/Delta-Chrome-MVP-0.7.3.zip` directly from the static site. Its bytes match `public/downloads/Delta-Chrome-MVP-0.7.3.zip` and `extension-package.json`. Reload the existing unpacked folder, confirm **Delta 0.7.3** in Chrome, then refresh YouTube. Every changed extension release must bump `extension/manifest.json`; packaging rejects an existing versioned ZIP with different bytes and allows identical rebuilds. Keep previous archives rather than deleting them to bypass the check. The backend API version is independent.

HTML, CSS and Hosting configuration are retained from the product source. Approved screenshot and media assets are deliberately not redistributed in this source snapshot; the live onboarding site contains the currently published presentation. Missing screenshot files do not affect the main React/Node product builds. This directory has no application JavaScript, added tracking or authentication bridge.

The Hosting config names the public Delta site. A fork must use its own authorized Firebase target. Do not deploy this target merely to inspect the source. Hosting the static page does not deploy or qualify the backend, sign-in, credit ledger or installed Chrome pilot. Reserved Firebase auth handlers retain their existing behavior.

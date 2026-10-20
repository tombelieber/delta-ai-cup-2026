# Delta store image assets

Prepared on 20 October 2026 for the 0.7.3 submission package. The actual recall capture comes from the previously deployed 0.7.2-era web application; that source interaction is unchanged by the payment-mode patch. Dimensions follow [Chrome Web Store's official image requirements](https://developer.chrome.com/docs/webstore/images).

| File | Dimensions | Purpose and provenance |
| --- | --- | --- |
| [icon-128.png](icon-128.png) | 128×128 PNG with transparency | Byte-identical copy of `extension/icons/icon-128.png`; the existing Delta icon is included in the qualified ZIP. |
| [promo-440x280.png](promo-440x280.png) | 440×280 PNG | Original deterministic brand artwork using Delta's existing icon, purple theme and “From watching to remembering.” It depicts branding, not a functional screen or measured outcome. |
| [screenshot-recall-1280x800.png](screenshot-recall-1280x800.png) | 1280×800 PNG, full bleed | Actual deployed accounting recall screen from the [reviewed original](../../verification/launch-hardening-2026-10-20/recall-deployed.jpg). Cropped to the 1040×650 rectangle at x=4, y=47, then uniformly resized to 1280×800. No interface, question, answer, source link or saved-state value was added or replaced. |

The screenshot preserves the actual answer and its four source timestamps. It contains public teaching-video examples and no account name, email, private viewing-history list, access token or credential. The original crop was already reviewed for public sharing; the final image was visually inspected after resizing. It is a picture of one supported interaction, not a guarantee of identical model output or a representation of a fresh user's preloaded library.

All image metadata was removed from newly rendered images. The icon retains its existing packaged bytes. The promotional image is distinct from the screenshot and should be uploaded to the small promotional-image field. The screenshot belongs in the screenshot field; the icon belongs in the store-icon field. A marquee image is optional and is not part of this minimum set.

These files do not establish publisher verification, listing submission, Google approval or signed-store installation. See the [listing preparation](../store-listing.md) and [reviewer instructions](../reviewer-instructions.md) for the remaining requirements.

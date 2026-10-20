# Delta store image assets

Prepared on 20 October 2026 for the 0.7.3 submission package. The actual recall capture comes from the previously deployed 0.7.2-era web application; that source interaction is unchanged by the payment-mode patch. Dimensions follow [Chrome Web Store's official image requirements](https://developer.chrome.com/docs/webstore/images).

| File | Dimensions | Purpose and provenance |
| --- | --- | --- |
| [icon-128.png](icon-128.png) | 128×128 PNG with transparency | Byte-identical copy of `extension/icons/icon-128.png`; the existing Delta icon is included in the qualified ZIP. |
| [promo-440x280.png](promo-440x280.png) | 440×280, 24-bit RGB PNG without alpha | Original deterministic brand artwork using Delta's existing icon, purple theme and “From watching to remembering.” It depicts branding, not a functional screen or measured outcome. |
| [screenshot-recall-1280x800.png](screenshot-recall-1280x800.png) | 1280×800 PNG, full bleed | Actual deployed accounting recall screen from the [reviewed original](../../verification/launch-hardening-2026-10-20/recall-deployed.jpg). Cropped to the 1040×650 rectangle at x=4, y=47, then uniformly resized to 1280×800. No interface, question, answer, source link or saved-state value was added or replaced. |

The screenshot preserves the actual answer and its four source timestamps. It contains public teaching-video examples and no account name, email, private viewing-history list, access token or credential. The original crop was already reviewed for public sharing; the final image was visually inspected after resizing. It is a picture of one supported interaction, not a guarantee of identical model output or a representation of a fresh user's preloaded library.

All image metadata was removed from newly rendered images. The icon retains its existing packaged bytes. The promotional image is distinct from the screenshot and should be uploaded to the small promotional-image field. The screenshot belongs in the screenshot field; the icon belongs in the store-icon field. A marquee image is optional and is not part of this minimum set.

On 21 October, the promotional PNG was normalized from RGBA to RGB to match the dashboard's no-alpha requirement. Every original alpha value was 255, and all decoded RGB pixels remain byte-identical; there is no visible design change. Its current SHA256 is `21b8f5eb2ef3586f702bf156c63616b60f4bdab8d45e94867eb2dbd240e5f8e1` (the prior opaque-RGBA file was `4cff1065af43c0e067d75f2932c34ad31a9757e0b53927f923bc7d487f62400d`). This does not change the extension ZIP.

All three assets were uploaded, saved and read back in the unpublished 0.7.3 draft. The dashboard renumbered the sole screenshot after save; that label is not a count of separate uploaded screenshots. Assets do not establish Google approval or signed-store installation. See the [dashboard receipt](../../verification/store-draft-2026-10-21.md), [listing preparation](../store-listing.md) and [reviewer instructions](../reviewer-instructions.md).

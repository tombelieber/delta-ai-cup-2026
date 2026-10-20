# Availability recovery — 20 October 2026

## Incident and cause

At 09:02 HKT, Cloud Run recorded a `/learn` HTTP 500 with the platform message `The request was aborted because there was no available instance`. An instance then started. The overlapping `/api/study/auth-config` request completed with HTTP 200 after 22.420 seconds, beyond the observer's 18-second deadline. The observer's timeout did not establish an authentication failure. Warm requests recovered before any change.

## Released change

Cloud Run revision **`delta-assistant-00018-nuk`** now serves **100% traffic** with startup CPU boost enabled. Its immutable image remains:

```text
us-central1-docker.pkg.dev/delta-511903/delta-images/delta-assistant@sha256:9b02c93425e6f5ceed87311ec6144c3c9699e6d2e78f09293bb93e2ba3631255
```

The image, complete environment fingerprint, runtime identity, secret bindings, authentication, quota and provider configuration matched the preceding revision. Minimum zero / maximum one instance, 1 vCPU / 512 MiB, concurrency eight and request-based CPU remain. Startup boost is temporary; it does not create an always-running minimum instance. This is a cold-start mitigation, not a guarantee against future platform errors or a monthly cost guarantee. See Google's [startup CPU boost documentation](https://docs.cloud.google.com/run/docs/configuring/services/cpu#set-startup).

The no-traffic candidate passed static-page, asset, ZIP-integrity and private-path checks. Its alternate tagged hostname correctly received `study_origin_required` on Study APIs: the canonical-origin guard was retained, not relaxed for testing. Image/environment/identity/resource equality and the exact template and traffic fingerprints were rechecked before traffic promotion; canonical-origin API checks followed promotion. The temporary tag was removed.

Firebase Hosting version **`fdce89071bcc0725`** was released at **11:49:31 HKT**. Only a **Watch the demo** hero action was added, pointing to `https://www.youtube.com/watch?v=XokomcChqWs`. The SUMIF teaching example remains a separate input-video link. The deployment preserved the six currently published files and live Hosting configuration; it did not promote other pending source changes. The resulting HTML SHA-256 is `164e380e646677bce397ee38ee1c21a18b242c3351b1b3b1bb168d5d87bf392d`.

## Production verification

| Normal public entry | Result | Sample duration |
| --- | --- | --- |
| Firebase Hosting homepage | 200, qualified demo linked | 0.257 s |
| Alternate `firebaseapp.com` homepage | 200, identical HTML | 0.315 s |
| `/learn?study=1` | 200 | 0.327 s |
| `/api/study/auth-config` | 200, Google auth enabled, US$0.50 default allowance | 0.284 s |
| `/api/study/session` without a token | 401 `authentication_required` | 0.256 s |
| Existing extension ZIP | 200, unchanged bytes and SHA-256 | 1.320 s |
| Firebase `/__/auth/handler` | 200, reserved handler still served | 0.459 s |

The extension remains 0.7.0 / Manifest V3, 1,901,959 bytes, SHA-256 `89268fa244f6212d7b03aa2fd5bed7a5323a25619fb7f415835ac95f42438206`. Homepage CSP and the original screenshots/CSS were retained. Browser review checked the demo target and absence of horizontal overflow at desktop and 390 px widths. Clicking **Try in browser** on the released homepage reached the working Learning lab and rendered **Sign in with Google** with the US$0.50 allowance.

These are individual availability samples, not cold-start benchmarks or an uptime SLA. No authenticated AI generation, payment, quota grant or history import was performed. This recovery qualifies anonymous onboarding/bootstrap and preservation of the authentication boundary; it does not requalify the entire authenticated product or release the pending Starter Pack implementation.

Future bounded observations should allow at least 45 seconds for scale-to-zero bootstrap requests, while recording actual durations. HTTP 500 remains a failure even if another request succeeds. Uptime alerts and full product telemetry remain separate work.

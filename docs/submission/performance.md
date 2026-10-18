# Performance and cost evidence

These are small historical curated observations, not representative model accuracy, learner impact, capacity or current live availability. No new inference was performed to prepare this source. Original identities, private records, captions, tokens and detailed runtime receipts are excluded.

## Historical production cohorts

| Cohort | Observation | Scope |
| --- | --- | --- |
| Initial four-topic run | Three of four first-pass lessons completed; HTTP 200 for Finance / IELTS / SUMIF; Accounting returned application 502 | One sample per topic on an earlier runtime |
| Changed Accounting candidate | One initial attempt succeeded, HTTP 200, 10.3709 seconds whole-request latency, US$0.013485 estimated debit | Changed prompt/runtime; not an unchanged retry or a four-topic first-pass result |
| Learning exercise/export checks | Eight distinct AI-authored exercise keys matched across four topics; four actual seven-slide PPTX files saved across two versions | Key agreement is not independent factual accuracy or learner improvement |
| Earlier Map workflow observation | 100 metadata records imported and retained after reload; 24 reviewed, 20 grouped and four unresolved, with 76 pending when the provider quota gate stopped work | Partial processing; model confidence enum is not measured precision |

Earlier whole-request lesson times were Finance 11.3951 s, IELTS 13.0670 s and SUMIF 8.9412 s; failed Accounting took 18.0854 s. These include backend and provider interaction. Provider-only latency and browser elapsed time were not measured.

## Completed Map cohort

Eight new classification HTTP attempts were observed across two changed runtime versions: seven returned HTTP 200 and one returned HTTP 502 with `invalid_provider_output`. A diagnostics-only patch preceded the bounded resume; there were no automatic retries or prompt/schema changes. This 7/8 HTTP-success result is separate from the lesson-generation denominators and does not measure classification accuracy.

The Map reached 100/100 reviewed: 80 grouped and 20 unresolved, with no items remaining ready for classification. Reload preserved these results. Metadata grouping is an organizational outcome, not evidence of knowledge or learning improvement. Private record contents and topic labels are excluded.

All eight new operations settled with US$0.049586 incremental estimated usage and no new outstanding reservations in that cohort. This is a conservative application estimate, not a provider invoice; earlier held reservations are outside this incremental figure. A subsequent one-question Recall check succeeded. The budget snapshot preceded that request, so it does not establish a post-Recall balance, new latency or learning gain.

## Historical local experiment

| Session | Recorded attempts | Usage unknown | Conservative cumulative API estimate |
| --- | ---: | ---: | ---: |
| Finance | 1 | 0 | US$0.0116745 |
| Accounting | 1 | 0 | US$0.0115380 |
| IELTS | 2 | 1 | US$0.0412695 |
| SUMIF + memory | 3 | 1 | US$0.0290310 |
| Total | 7 | 2 | US$0.0935130 |

Local lesson generation completed 4/5 attempts, memory generation 1/2 and all operations 5/7. First-attempt lesson completion was 3/4; eventual four-lesson completion does not replace those denominators. Unknown attempts retained reservations. Estimates are application accounting, not provider invoices.

Historical no-inference loopback timings used five samples after warm-up per path: cache median 1.447 ms, deterministic feedback 0.767 ms, retrieval with a model-boundary stub 1.198 ms and PPTX 4.495 ms. These are process overhead measurements, not live AI latency or concurrent capacity. The bounded benchmark tool needs separately supplied matching private inputs; this fresh public source cannot reproduce historical model outputs without them.

The [source audit](source-audit.md) checked one historical four-lesson corpus: 76/77 assertion fields aligned with supplied captions; one SUMIF generalization needed correction. Nineteen of 33 citation bundles fully covered their teaching content; fourteen needed surrounding context or narrower wording. This was AI-assisted inspection, not independent human verification or a representative accuracy study.

Financial examples use hypothetical assumptions; Accounting conventions require source/framework context; IELTS practice does not predict a band score. No retention, exam improvement, mastery, representative factual accuracy or production-scale guarantee is established.

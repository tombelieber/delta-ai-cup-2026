# Source alignment audit: four Delta lessons

This AI-assisted audit compares the fixed Finance, Accounting, IELTS and SUMIF JSON exports and their Markdown counterparts with the supplied local captions. It checks the selected source windows only: 0–300 seconds for the first three lessons and 35–186 seconds for SUMIF. This is a historical four-lesson audit. Original caption files, lesson outputs and detailed private evidence are intentionally not redistributed.

**Result:** 101 content fields were checked. Of 77 truth-bearing assertion fields, 76 align with the captions and one overgeneralizes the SUMIF demonstration. Separately, 19 of 33 citation bundles fully cover their associated teaching content; 14 need surrounding spans or narrower wording. These counts describe this fixed corpus. They are not a model-accuracy estimate, independent human review, or evidence of learning efficacy.

| Lesson | Content fields checked | Assertion fields: verified / unsupported / unresolved | Citation bundles: complete / needs review | Unique cited anchors |
|---|---:|---:|---:|---:|
| Finance | 23 | 17 / 0 / 0 | 8 / 0 | 7 |
| Accounting | 27 | 21 / 0 / 0 | 3 / 5 | 7 |
| IELTS | 27 | 21 / 0 / 0 | 4 / 4 | 7 |
| SUMIF | 24 | 17 / 1 / 0 | 4 / 5 | 4 |
| **Total** | **101** | **76 / 1 / 0 of 77** | **19 / 14 of 33** | **25** |

An assertion field is one summary, concept explanation, card body, individual bullet, or inferred intended-correct exercise option. A compound field counts once, after checking all its propositions. The other 24 fields are eight AI-created exercise stems and 16 deliberately incorrect alternatives; they were checked in their assessment roles and are not counted as asserted transcript facts. The expected exercise choices are inferred from the exported content; this audit does not inspect private grading keys.

All 44 citation-reference instances resolve to declared source anchors. All 39 declared anchors have caption content and lie within the selected windows; 25 distinct anchors are actually cited. Card and exercise `sourceTime` values match their referenced anchor starts. Thus there are **zero broken IDs or timestamp mismatches**, while semantic coverage still needs correction. Of the 44 references, 29 belong to complete bundles and 15 belong to partial bundles; multi-anchor concept references are assessed together.

## Concrete corrections

1. **Narrow the SUMIF requirement.** The concept at `/lesson/concepts/1/explanation` says three arguments are required. The [supplied demonstration](https://www.youtube.com/watch?v=dI8w0utjUc0&t=88s) uses a tested range, criterion and separate sum range; it does not establish a universal requirement. Safe wording: “This example supplies a criteria range, a criterion, and a separate range of values to add.” Official Excel syntax has not been independently checked in this audit.
2. **Keep Finance assumptions local.** The summary and both exercises explicitly say the rates are hypothetical. Repeat that label on the compounding card and scope the general time-value statement to the assumed positive return. The [source itself introduces the 10% return as an illustrative assumption](https://www.youtube.com/watch?v=733mgqrzNKs&t=11s). The arithmetic in the new exercises is consistent: 200 × 1.10 = 220; 100 × 1.05 = 105. No current investment offer, guaranteed market return, or financial recommendation is verified.
3. **Qualify Accounting conventions.** The [video groups dividends with financing](https://www.youtube.com/watch?v=DiVPAjgmnj0&t=259s), so the lesson matches that source. Scope the card and bakery exercise to the video's simplified convention and state that applicable accounting frameworks govern classification. Do not infer a universal dividend rule from these captions. The cash-basis Income Statement equivalence should likewise be attributed to the instructor's simplified explanation. No accounting standard was independently validated here.
4. **Preserve IELTS boundaries.** The source title contains “Band 9”; the generated teaching does not predict a learner's band. Describe the [three-part paragraph structure](https://www.youtube.com/watch?v=rXVR-nE2jvw&t=73s) as the instructor's recommended approach. The remote-work and parks scenarios are newly authored examples; their workplace and health premises are not transcript facts or independently verified empirical evidence. A key match does not assess essay quality, mastery, or an IELTS score.
5. **Repair the spans below and carry practice citations into Markdown.** Every Markdown card retains its JSON teaching text and source link. Markdown also retains all practice text, but omits the eight individual practice citations that exist in JSON. Add links explicitly labelled as evidence for the underlying principle, while retaining the AI-authored scenario label.

## Citation bundles requiring review

Indices below are zero-based JSON indices. Existing anchors are relevant; the problem is that they do not cover every part of a compound item. The additional anchors are available in each lesson's existing registry.

| Lesson and JSON item | Coverage gap | Safe correction |
|---|---|---|
| Accounting `slides/1` | Cited 83–111 seconds covers accrual; cash-basis equivalence precedes it and separate cash reporting follows it. | Add anchors `DiVPAjgmnj0-2` and `-4`. |
| Accounting `slides/2` | Cited 165–194 seconds lacks the detailed investing and financing definitions. | Add `DiVPAjgmnj0-7`. |
| Accounting `slides/3` | Cited 274–300 seconds supports owner flows; assets and bank borrowing are earlier. | Add `DiVPAjgmnj0-9`. |
| Accounting `exercises/0` | Earned revenue is supported; the cash-recognition contrast needs surrounding context. | Add `DiVPAjgmnj0-1` and `-4`; keep the consulting scenario labelled AI-authored. |
| Accounting `exercises/1` | The cited dividend span does not cover the van's asset classification. | Add `DiVPAjgmnj0-9` and the framework caveat. |
| IELTS `slides/0` | Prompt-checking and the main body's share of essay detail precede the cited promise metaphor. | Add `rXVR-nE2jvw-0`. |
| IELTS `slides/1` | Definitions are cited; the warning about competing structures and confused thinking is later. | Add `rXVR-nE2jvw-5`. |
| IELTS `slides/3` | Deep development is cited; the explicit shallow-breadth contrast starts earlier. | Add `rXVR-nE2jvw-8`. |
| IELTS `exercises/0` | The citation diagnoses a list; the explain-and-example prescription needs its structure or depth context. | Add `rXVR-nE2jvw-3` and/or `-8`. |
| SUMIF `concepts/1` | A demonstrated form is overstated as a mandatory rule. | Narrow the wording; adding the same spans does not prove the requirement. |
| SUMIF `slides/1` | Comma and criterion instructions begin after the cited range-selection span. | Add `dI8w0utjUc0-2`. |
| SUMIF `slides/2` | Formula closure and the returned result continue beyond the cited sum-range introduction. | Add `dI8w0utjUc0-3`. |
| SUMIF `exercises/0` | Tested-range order and explicit text-quotation guidance are outside the cited span. | Add `dI8w0utjUc0-1` and `-4`. |
| SUMIF `exercises/1` | Cell-reference guidance is cited; the final sum-range step follows it. | Add `dI8w0utjUc0-5`. |

## Limits and reproducibility

The ledger records every checked field, its hash, a short audit paraphrase, caption line/time evidence, every citation bundle and every declared anchor. It contains no raw caption dump or complete lesson output. The supplied caption files remain the comparison evidence; captions may be inaccurate, and IELTS uses auto-generated captions. No audio/video verification, external standards review, learner study, model re-generation, application mutation, runtime answer matching, PDF review, or PowerPoint review was performed by this audit.

The original JSON/Markdown disclaimers already identify AI-authored teaching and exercises and reject mastery or exam-score claims. They should remain. Parent corrections are recommendations, not changes made here; changing an audited export invalidates its snapshot hash and requires rechecking the affected ledger entries before reporting corrected counts.

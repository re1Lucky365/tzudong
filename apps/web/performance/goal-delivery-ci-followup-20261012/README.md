# Goal delivery CI follow-up

This follow-up keeps the first published delivery evidence immutable. The prior
head is `6bc5391b5f88e97435f0c645cb405b4b217b6a30`; its Ubuntu npm job failed
because an isolated source contract still required the old skeleton call and
removed explanatory copy. The test now checks the module-specific skeleton and
canonical title while preserving the loading/filter contracts.

The independent PR review also found that the Gemini verifier only inspected
Git dirtiness for its selected source paths. A modified unlisted execution
dependency could therefore be reported as a clean checkout. The verifier now
checks the entire worktree, and a regression test proves that an unlisted file
marks the receipt dirty. Selected source hashes are still recorded separately;
this does not invent a complete transitive dependency hash. Historical provider
receipts remain historical and do not prove the entire executed source closure.

Validation: status/filter tests 6 pass and 108 assertions; Gemini boundary tests
19 pass and 106 assertions; affected ESLint passed; native/compat compiler parity
passed with 0 diagnostics across 3,149 logical inputs. The Gemini test result
was produced by the named collaboration agent; the status test and parity were
run by root. No new provider call or database write occurred.

The application UI source is unchanged from the rendered webpack build
`HcJtq7WT9AGLOOijoRGrZ`. The CLI and test source are newer, so the previous
source manifest is not relabeled as a build of this follow-up. Current-head
hosted CI and release checks remain required. These checks establish behavior
and evidence boundaries, not measured speed, billing savings, or goal completion.

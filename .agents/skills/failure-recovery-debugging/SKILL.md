---
name: failure-recovery-debugging
description: Diagnose failures from reproducible evidence and avoid unbounded fix/retry loops.
---

# Failure Recovery Debugging

Use this skill when builds, tests, deployments, APIs, or runtime behavior fail.
1. Reproduce the failure with the smallest relevant command or scenario.
2. Capture the exact error and identify the first meaningful stack frame or failing assertion.
3. Form one or two evidence-based hypotheses; change one causal factor at a time.
4. Add a regression test when practical.
5. Verify the fix with the original failing case and nearby relevant checks.
6. If two or three attempts fail without new evidence, stop and broaden diagnosis or ask for missing information.
7. Do not suppress errors, weaken tests, or label an unverified workaround as a fix.

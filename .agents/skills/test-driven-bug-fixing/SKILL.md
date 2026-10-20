---
name: test-driven-bug-fixing
description: Prove a bug with a test, fix its root cause, and prevent recurrence.
---

# Test Driven Bug Fixing

Use this skill for reproducible bugs and regressions.
1. Reproduce the issue before changing code.
2. Write a minimal failing test or repeatable reproduction when feasible.
3. Trace the cause rather than patching only the visible symptom.
4. Make the smallest fix that addresses the cause.
5. Confirm the new test fails before the fix when practical and passes after it.
6. Run relevant adjacent tests and inspect for unintended behavior changes.
7. If a test cannot be added, document the manual verification and why automation was impractical.

---
name: observability-root-cause
description: Use logs, metrics, traces, and errors to find the source of failures.
---

# Observability Root Cause

Use this skill for production-like failures, distributed requests, or intermittent bugs.
1. Establish time window, affected operation, expected behavior, and observed symptoms.
2. Inspect relevant logs and traces with sensitive data redacted.
3. Follow request/correlation IDs across components when available.
4. Separate primary failure from downstream noise.
5. Add targeted instrumentation only when it will answer a concrete question.
6. Avoid logging secrets, full tokens, or unnecessary personal data.
7. Verify the proposed fix using the original failure path.

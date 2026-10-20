---
name: incremental-implementation
description: Implement the smallest safe change that fully satisfies the requirement.
---

# Incremental Implementation

Use this skill for feature work, bug fixes, refactors, and configuration changes.
1. Confirm the expected behavior and inspect the existing implementation.
2. Choose the smallest coherent patch that meets the acceptance criteria.
3. Reuse existing abstractions and dependencies unless there is evidence they are unsuitable.
4. Avoid unrelated formatting, naming changes, broad rewrites, or opportunistic refactors.
5. Add or update tests that cover the changed behavior.
6. Run targeted checks, inspect the diff, and verify no accidental files changed.
7. Explain any deliberate deviation from the requested scope.

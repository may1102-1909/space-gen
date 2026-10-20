---
name: refactoring-technical-debt
description: Improve code structure while preserving observable behavior.
---

# Refactoring Technical Debt

Use this skill for refactors, duplicate logic, difficult modules, or targeted technical debt.
1. Identify the behavior that must remain unchanged and existing tests that define it.
2. Refactor in small steps with a passing verification point after each meaningful change.
3. Separate structural changes from feature changes where practical.
4. Avoid broad abstractions without multiple real use cases.
5. Measure performance before and after when performance is the motivation.
6. Keep public APIs and persisted formats compatible unless a breaking change is approved.
7. Document remaining debt only when it affects future decisions.

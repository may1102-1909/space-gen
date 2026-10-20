---
name: senior-engineer-code-review
description: Review changes for correctness, regressions, maintainability, security, and scope.
---

# Senior Engineer Code Review

Use this skill to review a diff, pull request, or completed implementation.
1. Read the request and acceptance criteria before reviewing.
2. Inspect the diff and relevant surrounding code, not just the summary.
3. Prioritize concrete defects: incorrect behavior, data loss, security issues, race conditions, compatibility breaks, and missing tests.
4. Verify suspected issues with a targeted test or code path where possible.
5. Report findings by severity with file/line references and impact.
6. Separate blocking defects from optional style suggestions.
7. If no actionable defect is found, say so and state what was or was not tested.

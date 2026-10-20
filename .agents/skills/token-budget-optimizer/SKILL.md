---
name: token-budget-optimizer
description: Reduce unnecessary context, tool calls, repeated work, and oversized outputs while preserving correctness.
---

# Token Budget Optimizer

Use this skill for long tasks, large repositories, expensive tool use, or when context/usage is constrained.
1. Define the requested outcome and acceptance criteria in one compact statement.
2. Search targeted paths and symbols before opening files; read only relevant ranges.
3. Reuse verified results from the current session when inputs have not changed.
4. Prefer small patches and focused tests over whole-file rewrites and full-suite runs after every edit.
5. Summarize logs by extracting the first relevant error, stack frame, and surrounding context.
6. Batch independent read-only operations when safe; do not parallelize conflicting writes.
7. Avoid needless agent delegation, repeated polling, speculative browsing, and redundant planning.
8. Never omit essential verification or hide uncertainty merely to save tokens.
9. Report concise evidence, changed files, test outcomes, and remaining risks.

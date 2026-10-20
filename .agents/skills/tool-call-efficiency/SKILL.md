---
name: tool-call-efficiency
description: Use tools deliberately and avoid duplicate or low-value operations.
---

# Tool Call Efficiency

Use this skill for tool-heavy tasks, multi-agent work, and repository investigations.
1. Before a call, state what uncertainty it resolves or what artifact it produces.
2. Prefer precise search, scoped file reads, and commands with bounded output.
3. Batch independent read-only operations when supported.
4. Do not run conflicting writes or multiple package managers concurrently.
5. Avoid repeated status checks/polling without a state-change signal.
6. Cache or reuse results only while the underlying inputs remain unchanged.
7. Inspect command exit codes and relevant output; never assume success from silence.

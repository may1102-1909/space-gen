---
name: long-running-agent-orchestrator
description: Manage substantial work through milestones, checkpoints, bounded retries, and explicit completion evidence.
---

# Long Running Agent Orchestrator

Use this skill when a task is expected to take multiple work sessions or many implementation steps.
1. Establish goal, constraints, milestones, and a verification plan.
2. Work one coherent milestone at a time.
3. After each meaningful milestone, save completed work, changed files, tests, blockers, and the next exact action.
4. Resume from the latest verified checkpoint, not from assumptions or stale conversation summaries.
5. Set bounded retry limits; after repeated failure, diagnose or escalate rather than loop.
6. Do not claim background work continues after the current tool/session ends unless an actual persistent runner is configured.
7. Finish with a concise status and explicit unverified items.

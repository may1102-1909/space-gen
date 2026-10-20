---
name: project-memory
description: Manage persistent project memory, state snapshots, session recovery across interruptions, and context compaction triggers.
---

# Project Memory and Session Recovery Skill

<role>
You are a persistent state architect. Your goal is to ensure work can pause, resume, and survive across agent sessions, context compaction, or interruptions without loss of progress or duplicate work.
</role>

---

## When to Use

Activate this skill:
- **At session start**: To load previous context, understand where work left off, and avoid re-exploring code.
- **At milestone completion**: To capture verified progress, changed files, and acceptance proofs.
- **When context reaches 50% or 70%**: To dump state before context degrades.
- **Before handoffs or pauses**: To record the exact next command or action required.
- **When recovering from failures**: To restore the last known good state.

---

## State Storage Conventions

1. **Workspace State File**:
   - For standard projects: `.agent-state/PROGRESS.md`
   - For GSD projects: `.gsd/STATE.md`
   - *Never commit secrets, API keys, passwords, or massive raw logs into state files.*
   - Target length: **under 100 lines / 4 KB** for instant, low-token loading.

2. **Template Structure for `.agent-state/PROGRESS.md`**:

```markdown
# Session State & Progress

**Last Updated:** YYYY-MM-DD HH:MM
**Session Goal:** [Concise 1-sentence description]
**Current Status:** [PLANNING | IN_PROGRESS | BLOCKED | VERIFYING | COMPLETE]

---

## Acceptance Criteria
- [x] 1. [Completed criterion]
- [ ] 2. [Active criterion]
- [ ] 3. [Pending criterion]

---

## Active Milestone
- **Milestone:** [e.g. Milestone 2: API Endpoints]
- **Current Step:** [e.g. Implementing auth middleware]
- **Exact Next Action:** [e.g. Run `pytest tests/test_auth.py` and inspect token expiration]

---

## Completed Tasks
- [YYYY-MM-DD] Implemented XYZ feature (Commit: `abc1234`)
  - Changed files: `backend/routes/auth.py`, `backend/models/user.py`
  - Verification: `pytest tests/test_auth.py` passed (4 tests)

---

## Known Blockers & Decisions
- Decision: Use Pydantic v2 `BaseModel` instead of dataclasses for validation.
- Blocker: None.

---

## Session Resumption Instructions
1. Run `git status` to ensure clean working tree.
2. Read the "Active Milestone" and "Exact Next Action".
3. Execute the next action without repeating completed tasks.
```

---

## Protocols

### 1. Session Initialization & Recovery Protocol

When starting in an existing or ongoing workspace:

1. **Check for state files**:
   ```powershell
   Test-Path .agent-state/PROGRESS.md, .gsd/STATE.md
   ```
2. **Read the state file first** before exploring the codebase.
3. **Verify Git state**:
   ```powershell
   git status
   git log -1 --oneline
   ```
4. **Confirm alignment**: Check that the working tree matches the state recorded in `PROGRESS.md`.
5. **Resume directly** at `Exact Next Action`.

### 2. Checkpoint Protocol (After Every Milestone)

After completing a coherent unit of work:

1. **Verify empirically**: Run the relevant test, build, or verification script. Do not write progress based on assumptions.
2. **Commit changes**: Create an atomic git commit (`git commit -m "feat(scope): ..."`).
3. **Update state file**:
   - Check off the completed acceptance criterion.
   - Record touched files and the test output summary.
   - Define the single `Exact Next Action` for the following step.
4. **Keep it lean**: Replace verbose task descriptions with single-line summaries to preserve low context size.

### 3. Context Degradation & Compaction Trigger

Monitor token and context usage:

| Context Usage | Trigger Level | Action Required |
| :--- | :--- | :--- |
| **0 – 50%** | Normal | Proceed normally with task execution. |
| **50 – 70%** | Compression | Stop reading new files. Update `.agent-state/PROGRESS.md`. Discard transient thoughts. |
| **> 70%** | State Dump | 1. Write full state snapshot to `.agent-state/PROGRESS.md`.<br>2. Commit any pending work.<br>3. Recommend `/compact` or fresh session restart. |

---

## Anti-Patterns to Avoid

- ❌ **Storing whole logs**: Never copy entire 500-line compiler or terminal logs into the state file. Record only: `Result: Failed at Line 42 (ModuleNotFoundError: 'xyz')`.
- ❌ **Speculative next steps**: Never leave `Next Action` vague like "Continue development". Make it actionable: `Run python -m pytest tests/test_models.py`.
- ❌ **Stale state**: Never complete a task and start another without updating the state file.
- ❌ **Leaking secrets**: Never write `.env` values or tokens into `PROGRESS.md`.

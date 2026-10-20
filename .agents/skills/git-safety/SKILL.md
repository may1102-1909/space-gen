---
name: git-safety
description: Enforce safe Git operations, atomic commits, branch isolation, stash hygiene, and recovery without data loss across shells.
---

# Git Safety and Recovery Skill

<role>
You are a version control safety specialist. Your job is to protect code integrity, ensure clear atomic history, prevent accidental data loss, and maintain reliable shell execution across operating systems.
</role>

---

## When to Use

Activate this skill:
- **Before editing code**: To verify branch state and ensure no uncommitted collision.
- **When committing changes**: To ensure clean, atomic, conventional commits.
- **When switching tasks**: To safely stash or checkpoint in-flight work.
- **When recovering from errors**: To safely restore files or revert without losing work.
- **In Windows environments**: To ensure commands execute without shell syntax errors.

---

## Core Safety Rules

1. **Discrete Shell Commands (Never Chain with `&&` or `||`)**:
   - In Windows PowerShell 5.1, `&&` causes a syntax error. A command like `git add . && git commit` will fail silently or abort before commit.
   - **Always** execute commands as separate calls, or run them sequentially with semicolons/new lines, inspecting output after each.

2. **No Blind Staging**:
   - Avoid `git add .` or `git add -A` if untracked files, credentials (`.env`), or heavy build outputs (`node_modules/`, `dist/`) exist.
   - Stage specific files explicitly: `git add frontend/components/Canvas.tsx`.

3. **No Empty Commits**:
   - Never use `--allow-empty`. A task with no actual code or config changes is not complete.

4. **Confirm Commit Landed**:
   - Always run `git log -1 --oneline` immediately after committing to guarantee the commit was registered.

5. **No Destructive Operations Without Backups**:
   - Never run `git reset --hard` or `git clean -fd` without creating a temporary backup branch:
     ```powershell
     git branch safety-backup-before-reset
     ```

---

## Standard Workflows

### 1. Pre-Implementation Safety Check

Before touching code:

```powershell
# 1. Check current branch
git branch --show-current

# 2. Check working tree cleanliness
git status --short
```

If uncommitted work exists from another task:
```powershell
# Create an explicit named stash
git stash push -m "WIP: before starting task XYZ"
```

### 2. Atomic Commit Protocol

Follow this exact sequence for each completed task:

```powershell
# Step 1: Check modified files
git status --short

# Step 2: Stage explicitly
git add <path/to/modified/file>

# Step 3: Verify staged diff summary
git diff --staged --stat

# Step 4: Commit with conventional message
git commit -m "feat(scope): concise description of change"

# Step 5: Verify commit registration
git log -1 --oneline
```

**Conventional Commit Types:**
- `feat(scope)`: New feature or capability
- `fix(scope)`: Bug fix
- `refactor(scope)`: Code restructure without behavioral changes
- `test(scope)`: Adding or updating tests
- `docs(scope)`: Documentation only
- `chore(scope)`: Build tools, dependencies, or maintenance

### 3. Safe Stash & Context Switch

When pausing a task to work on a bug or review:

```powershell
# Save with clear label
git stash push -m "savepoint-phase1-part2"

# View stashes
git stash list

# To restore:
git stash apply stash@{0}
# If satisfied after testing:
git stash drop stash@{0}
```

### 4. Recovery Procedures

#### A. Staged unwanted files
```powershell
git restore --staged <file>
```

#### B. Discard uncommitted changes to a single file safely
```powershell
# Verify diff first before discarding
git diff <file>
git restore <file>
```

#### C. Accidental commit on wrong branch
```powershell
# 1. Create branch with the commit
git branch feature/my-feature

# 2. Reset the current branch back one commit safely
git reset --soft HEAD~1
```

---

## Checklist Before Finishing Any Git Operation

- [ ] Command ran without syntax errors (no `&&` failures in PowerShell).
- [ ] Only intentional files were staged (no `.env`, `.pem`, temporary dumps).
- [ ] Tests and verifications ran before the commit.
- [ ] Commit message follows conventional format.
- [ ] Commit is verified with `git log -1 --oneline`.

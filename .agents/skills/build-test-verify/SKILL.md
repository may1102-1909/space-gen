---
name: build-test-verify
description: Run, diagnose, and verify multi-runtime builds, type checks, linting, and automated tests with quick-fail ergonomics and empirical proof.
---

# Build, Test, and Verification Skill

<role>
You are a verification and developer productivity specialist. Your job is to empirically prove that code compiles, passes type checks, runs cleanly, and satisfies tests across Node/TypeScript and Python ecosystems without guessing.
</role>

---

## When to Use

Activate this skill:
- **Before committing any code change**: To verify no syntax errors, broken imports, or type regressions were introduced.
- **Before marking any milestone or task complete**: To capture objective empirical proof.
- **When checking multi-runtime environments**: Node.js/Next.js/TypeScript and Python/FastAPI.
- **When dependencies are missing or partially installed**: To run static and syntax dry-runs honestly without fabricating results.

---

## The Non-Negotiable Proof Standard

1. **Never claim success without running the command**:
   - Saying "I verified the code and it has no errors" without terminal execution output violates system rules.
2. **Handle missing environments honestly**:
   - If `node_modules` or a Python `venv` is not installed on disk, state this explicitly.
   - Run syntax dry-runs (e.g., Python compilation or AST parsing) and document: *"Syntax dry-run passed; full integration build requires `npm install` / `venv` activation."*
3. **Capture compact proof**:
   - Record: `Command executed`, `Exit code`, `Passed/Failed count`, and `Error snippet` (if failed).

---

## Verification Procedures by Runtime

### 1. Node.js / React / Next.js / TypeScript

#### A. Type Checking
```powershell
# From the frontend directory:
cd frontend
npx tsc --noEmit
```
*If `node_modules` is missing, verify `tsconfig.json` paths and TypeScript syntax without claiming full compilation.*

#### B. Next.js Build & Lint
```powershell
cd frontend
npm run lint
npm run build
```

#### C. Quick Script / File Syntax Check
If Node is available but dependencies are uninstalled:
```powershell
node --check <file.js>
```

---

### 2. Python / FastAPI / Data Science

#### A. Rapid Byte-Compilation (Syntax Check)
Instant check that catches missing colons, bad indentation, or invalid syntax without needing runtime dependencies:
```powershell
# Single file:
python -m py_compile backend/main.py

# Entire directory:
python -m compileall -q backend/
```

#### B. Import & Module Loading Check
Verify that modules load and dependencies resolve:
```powershell
python -c "import sys; print('Python executable:', sys.executable)"
# If venv active:
python -c "import backend.config; print('Config loaded successfully')"
```

#### C. Running Pytest
```powershell
python -m pytest -v --tb=short
```

---

### 3. PowerShell & Helper Scripts

#### A. PowerShell Script Syntax Validation
Before executing any `.ps1` script, verify it parses without syntax errors:
```powershell
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("scripts/validate-all.ps1", [ref]$null, [ref]$errors)
if ($errors.Count -eq 0) { "Valid PowerShell syntax" } else { $errors }
```

#### B. Running Project Validators
SpaceGen includes dedicated project validators in `scripts/`:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/validate-all.ps1
```

---

## Verification Result Reporting Template

When reporting verification to the user or recording in `.agent-state/PROGRESS.md`:

```markdown
### Verification Evidence
- **Target:** `backend/services/reconstruction.py`
- **Command:** `python -m py_compile backend/services/reconstruction.py`
- **Exit Code:** `0`
- **Output:** Clean compilation, 0 syntax errors.
- **Environment Status:** Python 3.11.9 detected.
```

---

## Checklist

- [ ] Command executed individually without shell chaining (`&&`).
- [ ] Terminal output or exit code was directly observed.
- [ ] Any test failures or type errors were resolved before committing.
- [ ] If dependencies were missing, the exact command to install them was documented.

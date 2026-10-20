---
name: code-review-security
description: Audit code changes for security vulnerabilities, secret leakage, dangerous shell patterns, and architectural regressions.
---

# Code Review and Security Auditing Skill

<role>
You are a staff security engineer and principal code reviewer. Your job is to audit diffs before merging or committing, detecting credential exposure, injection vectors, unsafe shell commands, and architectural anti-patterns.
</role>

---

## When to Use

Activate this skill:
- **Before committing any new feature or refactor**: As an independent sanity audit.
- **When touching API endpoints or database queries**: To verify input validation and authorization.
- **When adding third-party dependencies or external integrations**: To inspect for supply chain security.
- **When writing shell or automation scripts**: To prevent command injection.

---

## Security Audit Checklist

### 1. Secret & Credential Leakage (Zero Tolerance)
- **Check for Hardcoded Keys**:
  - `AI Studio / GEMINI_API_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` / `ANON_KEY`
  - `VERCEL_TOKEN`, AWS keys, GitHub PATs
  - Private RSA/SSH keys
- **Verify `.gitignore` Coverage**:
  - `.env`, `.env.local`, `*.pem`, `*.key`, `data/reconstruction/*` must never be staged.
- **Scan Staged Diff Before Commit**:
  ```powershell
  git diff --staged | Select-String -Pattern "(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE KEY)"
  ```

### 2. Injection & Command Execution Safety
- **Python / Backend**:
  - ❌ Never use `subprocess.run(..., shell=True)` with unvalidated string formatting.
  - ✅ Pass arguments as an array: `subprocess.run(["ffmpeg", "-i", input_path, output_path])`.
  - ❌ Never interpolate strings into raw SQL queries.
  - ✅ Use parameterized queries or ORM/Pydantic schemas.
- **PowerShell / Shell**:
  - Quote file paths: `"$filePath"` to handle spaces in directories.

### 3. API & Data Validation
- Ensure all FastAPI endpoints validate payloads via Pydantic models.
- Reject unexpected fields with `extra = 'forbid'` when strict security is required.
- Enforce CORS policies: avoid wildcard `allow_origins=["*"]` with `allow_credentials=True`.
- Ensure Supabase tables have **Row Level Security (RLS)** enabled.

### 4. Code Quality & Maintainability
- **Complexity**: Identify functions with excessive nesting (>3 levels) or cyclomatic complexity.
- **Error Handling**: Verify errors fail gracefully without leaking database internal schemas or full stack traces to clients.
- **Dead Code**: Ensure no debugging logs (`console.log`, `print`) are left in production paths.

---

## Review Output Format

When providing code review feedback:

```markdown
### Security & Quality Review

- **Status:** [PASSED | NEEDS_REVISION | BLOCKED]
- **Audited Files:** `[list of files]`

#### Findings
1. [SEVERITY: HIGH/MED/LOW] [File:Line] Description of risk.
   - *Recommendation:* Specific fix.

#### Verification
- [x] No secrets in staged diff
- [x] Input validation present
- [x] Shell commands parameterized
```

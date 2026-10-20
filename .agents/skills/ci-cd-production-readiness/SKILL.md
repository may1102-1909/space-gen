---
name: ci-cd-production-readiness
description: Run appropriate automated checks and prepare changes for reliable release.
---

# Ci Cd Production Readiness

Use this skill before merging or releasing meaningful code changes.
1. Inspect CI configuration and repository-defined scripts.
2. Run focused tests first, then required lint/type/build/test checks.
3. Check environment configuration and migration compatibility.
4. Review the diff, generated artifacts, secrets, and dependency changes.
5. Verify failure handling and rollback expectations for risky changes.
6. Report commands and outcomes accurately; distinguish skipped from passed checks.

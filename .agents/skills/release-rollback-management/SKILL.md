---
name: release-rollback-management
description: Prepare safe releases with smoke checks and recovery paths.
---

# Release Rollback Management

Use this skill for releases, schema migrations, feature flags, or production changes.
1. Define release scope, dependencies, compatibility risks, and rollback criteria.
2. Verify tests and build artifacts before release.
3. Prefer staged rollout or feature flags for risky changes.
4. Ensure database migrations are compatible with the rollback plan.
5. Run smoke checks and observe relevant metrics after deployment.
6. Roll back or pause when predefined failure thresholds are met.
7. Record the actual release state and remaining risks.

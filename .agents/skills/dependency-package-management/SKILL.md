---
name: dependency-package-management
description: Keep dependencies compatible, minimal, and auditable.
---

# Dependency Package Management

Use this skill when adding, removing, upgrading, or debugging packages.
1. Inspect package manifests, lockfiles, runtime versions, and existing dependency alternatives.
2. Check official package documentation and supported version ranges when compatibility matters.
3. Prefer existing dependencies and standard-library functionality when adequate.
4. Make reproducible lockfile changes using the repository's package manager.
5. Review lifecycle scripts, license, maintenance, transitive footprint, and known vulnerabilities.
6. Run install/build/tests after changes.
7. Do not upgrade unrelated dependencies as a side effect.

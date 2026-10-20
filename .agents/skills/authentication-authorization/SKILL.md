---
name: authentication-authorization
description: Implement and review identity, sessions, roles, and access control.
---

# Authentication Authorization

Use this skill for login, sessions, OAuth, permissions, multi-tenant access, or security boundaries.
1. Identify trust boundaries and the authoritative identity provider.
2. Enforce authorization on every sensitive server-side operation.
3. Use secure session/token handling and follow provider guidance.
4. Check tenant/resource ownership, privilege escalation, CSRF, redirect validation, and session expiry where applicable.
5. Test both allowed and denied paths.
6. Do not roll your own cryptography or store plaintext credentials.
7. Never weaken access controls just to make a test pass.

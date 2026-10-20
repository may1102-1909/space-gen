---
name: rate-limits-retries-backoff
description: Handle transient failures without retry storms or duplicate side effects.
---

# Rate Limits Retries Backoff

Use this skill for APIs, cloud services, queues, and flaky network operations.
1. Distinguish transient errors from permanent validation/authentication failures.
2. Use bounded exponential backoff with jitter where appropriate.
3. Respect Retry-After and provider-specific quotas.
4. Apply idempotency keys or deduplication for operations with side effects.
5. Set timeouts and an overall retry budget.
6. Surface persistent failures clearly and avoid infinite loops.
7. Test retry behavior without overwhelming external services.

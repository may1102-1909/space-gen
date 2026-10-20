---
name: environment-secret-management
description: Manage configuration and secrets safely across local, CI, and production environments.
---

# Environment Secret Management

Use this skill for environment variables, credentials, API keys, or deployment configuration.
1. Identify required variable names and which runtime consumes each one.
2. Keep real secrets in approved secret stores or ignored local environment files.
3. Provide safe example files containing placeholders only.
4. Validate missing configuration with actionable messages.
5. Never print secret values or commit them.
6. Rotate exposed credentials and notify the user if a leak is discovered.
7. Verify the app handles missing/invalid configuration safely.

---
name: browser-e2e-testing
description: Verify real user journeys in a browser with stable, meaningful assertions.
---

# Browser E2E Testing

Use this skill for web flows, forms, auth, checkout-like flows, dashboards, or browser-driven automation.
1. Identify the critical user journey and expected visible outcomes.
2. Use stable roles, labels, and test IDs rather than brittle selectors when possible.
3. Set explicit waits on state changes; avoid arbitrary sleeps.
4. Test success, validation, error, and recovery paths as risk warrants.
5. Keep test data isolated and clean up safely.
6. Capture relevant failure evidence without exposing private data.
7. Do not report a flow as passed unless it was actually executed.

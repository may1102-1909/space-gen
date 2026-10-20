---
name: browser-automation-resilience
description: Build resilient browser automation, anti-flakiness flows, exponential retries, and end-to-end DOM verification.
---

# Browser Automation and Resilient Retries Skill

<role>
You are a senior browser automation and QA engineer. Your job is to create resilient, non-flaky automation workflows, handle dynamic DOM states, manage rate-limiting, and capture empirical visual verification.
</role>

---

## When to Use

Activate this skill:
- **Building automation scripts**: Job application bots (Tanishq AutoApply), web scrapers, or browser-based workflows.
- **Writing End-to-End (E2E) tests**: Playwright, Puppeteer, or Cypress suites.
- **Handling dynamic Single-Page Applications (SPAs)**: Waiting for React/Next.js hydration and async network requests.
- **Managing flakiness and transient errors**: Rate limits, CAPTCHA hurdles, network disconnects, or unexpected DOM changes.

---

## Resilience Principles

### 1. Never Use Hardcoded Sleeps (`sleep(5000)`)
- Arbitrary sleeps waste tokens, slow execution, and fail under variable network conditions.
- **Use explicit condition polling and locator assertions**:
  ```typescript
  // ❌ Bad: Arbitrary blind wait
  await page.waitForTimeout(5000);

  // ✅ Good: Wait for explicit DOM state
  await page.locator('[data-testid="submit-application"]').waitFor({ state: 'visible', timeout: 15000 });
  await expect(page.locator('.success-banner')).toBeVisible();
  ```

### 2. Wait for Framework Hydration (React / Next.js)
- When automating modern frameworks, buttons may be visible in the DOM before hydration event listeners are attached.
- Wait for client readiness or network idle:
  ```typescript
  await page.waitForLoadState('domcontentloaded');
  // Wait for the root interactive element to respond
  await page.locator('#__next, #root').waitFor({ state: 'attached' });
  ```

### 3. Exponential Backoff with Jitter
For retrying flaky network operations or rate-limited pages:

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) throw error;
      // Exponential delay with randomized jitter
      const jitter = Math.random() * 200;
      const delay = baseDelayMs * Math.pow(2, attempt) + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}
```

### 4. DOM Snapshot & Failure Capture
- On unexpected automation failure:
  1. Capture the current page URL.
  2. Take a compressed screenshot (`page.screenshot({ path: 'failure.png', quality: 60 })`).
  3. Extract concise error banners rather than dumping the full 10,000-line DOM.

---

## Verification & Anti-Flakiness Checklist

- [ ] All selectors use resilient attributes (`data-testid`, semantic roles `getByRole`, or ARIA labels) instead of brittle CSS paths (`div > div:nth-child(3)`).
- [ ] No hardcoded `time.sleep()` or `page.waitForTimeout()`.
- [ ] Retries are applied only to transient errors (network, timeout), never to logical errors (invalid password, bad schema).
- [ ] Screenshots are captured at key completion milestones as empirical proof.

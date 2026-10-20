---
name: ai-eval-benchmark
description: Evaluate AI agent trajectories, prompt quality, token efficiency, structured schema outputs, and model benchmarks.
---

# AI Application and Agent Evaluation Skill

<role>
You are an AI systems architect and evaluation engineer. Your job is to rigorously evaluate agent trajectories, measure prompt quality, validate structured outputs, optimize token expenditures, and benchmark model performance.
</role>

---

## When to Use

Activate this skill:
- **Developing AI and agent applications**: DAWN, SpaceGen Gemini backend, or LLM-driven pipelines.
- **Enforcing structured JSON outputs**: Defining and validating response schemas with the `google-genai` SDK or OpenAI/Anthropic APIs.
- **Benchmarking prompt variations**: Comparing latency, token usage, and output quality across prompt revisions.
- **Auditing agent performance**: Measuring tool calling accuracy, reducing agent loop iterations, and verifying acceptance criteria.
- **Optimizing token economics**: Utilizing context caching and model tiering (Flash vs. Pro).

---

## Core Evaluation Principles

### 1. Strict Schema Enforcement
Always bind structured output schemas to API calls to prevent malformed responses and markdown fence parsing errors:

```python
from google import genai
from google.genai import types
from pydantic import BaseModel

class RoomDesignProposal(BaseModel):
    theme: str
    suggested_palette: list[str]
    layout_modifications: list[str]
    confidence_score: float

client = genai.Client()
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=user_prompt,
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=RoomDesignProposal,
        temperature=0.2,
    ),
)
```

### 2. Model Tiering & Cost Discipline
- **Flash Tier (`gemini-2.5-flash`)**:
  - Use for: Routine categorization, formatting, initial file triage, summary extraction, quick tool calls.
  - Cost/Token savings: ~10x cheaper and 3x faster than Pro.
- **Pro Tier (`gemini-2.5-pro`)**:
  - Use for: High-context architectural planning, subtle debugging across multiple files, and final milestone verification.

### 3. Agent Trajectory Metrics
When evaluating an agent's run:

| Metric | Target | Warning Threshold |
| :--- | :--- | :--- |
| **Tool Calls per Task** | < 8 calls | > 15 calls (indicates looping/flailing) |
| **Repeated File Reads** | 0 re-reads | > 1 re-read of unchanged file |
| **Tokens Consumed** | < 25k per simple task | > 80k without checkpointing |
| **Output Schema Validity** | 100% valid JSON | Any schema parse retry |

### 4. Regression Benchmark Protocol
Before modifying a core prompt in production:

1. **Establish a Ground-Truth Dataset**: Maintain 5–10 representative test prompts and expected output attributes in `tests/eval_dataset.json`.
2. **Run Comparative Evaluation**:
   - Compare outputs on: Accuracy, schema compliance, latency (ms), and token consumption.
3. **Capture Empirical Proof**: Document the benchmark diff before approving prompt revisions.

---

## Evaluation Checklist

- [ ] Schema is strictly typed with Pydantic or JSON schema.
- [ ] Output is parsed directly into model instances without regex hacks.
- [ ] Token usage (input, output, cached) is measured and reported.
- [ ] Flash model evaluated first before escalating to Pro.
- [ ] Agent trajectory reaches verification in minimal tool steps.

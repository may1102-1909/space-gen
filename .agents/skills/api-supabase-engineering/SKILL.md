---
name: api-supabase-engineering
description: Design robust REST/FastAPI endpoints, Pydantic v2 schemas, database connections, and Supabase PostgreSQL with RLS.
---

# API and Supabase Engineering Skill

<role>
You are a staff backend and database engineer. Your job is to architect scalable FastAPI and Node services, design clean Pydantic v2 schemas, and ensure secure, performant Supabase PostgreSQL operations.
</role>

---

## When to Use

Activate this skill:
- **Designing backend APIs**: FastAPI routes, middleware, and request/response models.
- **Configuring Supabase**: Database tables, Row Level Security (RLS) policies, Realtime channels, and Storage buckets.
- **Handling async operations**: Async endpoint concurrency, background tasks, and blocking I/O isolation.
- **Writing external HTTP clients**: Robust `httpx` or `fetch` integrations with timeouts and error handling.
- **Writing migrations**: Versioned SQL scripts and schema evolution.

---

## Engineering Guidelines

### 1. FastAPI Architecture
- **Async vs Sync Endpoints**:
  - Use `async def` only when performing non-blocking I/O (`await db_query()`, `await httpx.get()`).
  - Use standard `def` for CPU-bound tasks or synchronous libraries (e.g. OpenCV image processing); FastAPI runs synchronous endpoints in a separate thread pool automatically.
- **Dependency Injection**:
  - Inject database sessions, auth context, and config via `fastapi.Depends`:
    ```python
    @router.get("/designs/{design_id}")
    async def get_design(
        design_id: str,
        user: AuthenticatedUser = Depends(get_current_user),
        db: DatabaseSession = Depends(get_db)
    ):
        ...
    ```

### 2. Pydantic v2 Schema Modeling
- Use `ConfigDict` and typed fields:
  ```python
  from pydantic import BaseModel, ConfigDict, Field

  class SpatialObjectCreate(BaseModel):
      model_config = ConfigDict(extra="forbid", frozen=True)

      name: str = Field(..., min_length=1, max_length=100)
      position: tuple[float, float, float]
      rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)
      scale: tuple[float, float, float] = (1.0, 1.0, 1.0)
  ```

### 3. Supabase & PostgreSQL Security & Performance
- **Row Level Security (RLS)**:
  - **Always enable RLS** on every public table:
    ```sql
    ALTER TABLE public.user_designs ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users can only read own designs"
      ON public.user_designs
      FOR SELECT
      USING (auth.uid() = user_id);
    ```
- **Indexes**:
  - Index foreign keys (`user_id`, `project_id`) and timestamp columns used in sorting.
- **Connection Hygiene**:
  - Always use Supabase transaction poolers (port 6543) or session poolers (port 5432) appropriately to prevent connection exhaustion.

### 4. Resilient External HTTP Integrations
- Always set explicit timeouts on client calls:
  ```python
  import httpx

  async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
      response = await client.post(url, json=payload)
      response.raise_for_status()
  ```

---

## Verification Runbook

1. **Compile & Check FastAPI Routes**:
   ```powershell
   python -m py_compile backend/main.py
   ```
2. **Verify SQL Migration / Syntax**:
   - Inspect RLS policies for policy leaks (`auth.uid()` vs `anon`).
   - Confirm foreign key constraints have corresponding indexes.

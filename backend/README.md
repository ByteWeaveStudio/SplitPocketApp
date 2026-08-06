# SplitPocket API

FastAPI backend for SplitPocket. Verifies Supabase Auth tokens and owns the
business logic (splits, balances, settlements).

## Run

```sh
uv sync
cp .env.example .env   # fill in Supabase values when available
uv run uvicorn app.main:app --reload --port 8000
```

- Health check: http://localhost:8000/api/v1/health
- API docs: http://localhost:8000/docs

## Lint

```sh
uv run ruff check .
uv run ruff format .
```

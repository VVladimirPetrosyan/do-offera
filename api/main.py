"""do-offera — cloud draft API for the resume builder.

Stores resume drafts by a device code (no accounts, no personal-data profile):
the user explicitly presses "Облако" in the builder, so the draft they send
is their own resume draft. Deploy: Render (free) + Neon (free PostgreSQL).
DATABASE_URL lives only in the platform's environment variables (never in git).
"""
import json
import os
import re
import time

import asyncpg
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

DEVICE_RE = re.compile(r"^[a-f0-9]{16}$")
MAX_PAYLOAD = 1_000_000  # 1 MB cap: drafts with a base64 photo fit well below this
DRAFT_TTL_DAYS = 90

app = FastAPI(title="do-offera cloud draft", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://do-offera.ru",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

_pool = None
_last_cleanup = 0.0
_hits: dict[str, list[float]] = {}


async def pool():
    global _pool
    if _pool is None:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise HTTPException(status_code=503, detail="DATABASE_URL is not set")
        # asyncpg needs the postgresql:// scheme; Neon URLs use postgres://
        url = url.replace("postgres://", "postgresql://", 1)
        _pool = await asyncpg.create_pool(url, min_size=0, max_size=3)
    return _pool


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limited(ip: str, limit: int = 60, window: float = 60.0) -> bool:
    now = time.time()
    hits = [t for t in _hits.get(ip, []) if now - t < window]
    hits.append(now)
    _hits[ip] = hits[-limit:]
    return len(hits) > limit


async def cleanup_once() -> None:
    """Prune stale drafts (runs at most once per hour on POST)."""
    global _last_cleanup
    now = time.time()
    if now - _last_cleanup < 3600:
        return
    _last_cleanup = now
    p = await pool()
    await p.execute(
        f"DELETE FROM drafts WHERE updated_at < now() - interval '{DRAFT_TTL_DAYS} days'"
    )


@app.get("/health")
async def health():
    return {"ok": True, "service": "cloud-draft"}


@app.post("/draft/{device_code}")
async def save_draft(device_code: str, request: Request):
    if rate_limited(client_ip(request)):
        raise HTTPException(status_code=429, detail="too many requests")
    if not DEVICE_RE.match(device_code):
        raise HTTPException(status_code=400, detail="bad device code")
    body = await request.body()
    if len(body) > MAX_PAYLOAD:
        raise HTTPException(status_code=413, detail="draft too large")
    try:
        json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="body must be valid JSON")
    p = await pool()
    await p.execute(
        "INSERT INTO drafts (device_code, payload, updated_at) VALUES ($1, $2, now()) "
        "ON CONFLICT (device_code) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()",
        device_code,
        body.decode("utf-8"),
    )
    await cleanup_once()
    return {"ok": True}


@app.get("/draft/{device_code}")
async def get_draft(device_code: str, request: Request):
    if rate_limited(client_ip(request)):
        raise HTTPException(status_code=429, detail="too many requests")
    if not DEVICE_RE.match(device_code):
        raise HTTPException(status_code=400, detail="bad device code")
    p = await pool()
    row = await p.fetchrow(
        "SELECT payload FROM drafts WHERE device_code = $1", device_code
    )
    if not row:
        raise HTTPException(status_code=404, detail="draft not found")
    return Response(content=row["payload"], media_type="application/json")

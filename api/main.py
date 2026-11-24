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
import requests
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from db import clean_dsn

DEVICE_RE = re.compile(r"^[a-f0-9]{16}$")
MAX_PAYLOAD = 1_000_000  # 1 MB cap: drafts with a base64 photo fit well below this
DRAFT_TTL_DAYS = 90
MAX_LEAD_BODY = 10_000  # a lead is a short form: name, contact, one message
LEAD_NAME_MAX = 120
LEAD_CONTACT_MAX = 120
LEAD_MSG_MAX = 1000

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

SCHEMAS = (
    "CREATE TABLE IF NOT EXISTS drafts ("
    "device_code TEXT PRIMARY KEY, payload JSONB NOT NULL, "
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS leads ("
    "id SERIAL PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, "
    "message TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'site', "
    "consent BOOLEAN NOT NULL, status TEXT NOT NULL DEFAULT 'new', "
    "b24_lead_id INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS lead_events ("
    "id SERIAL PRIMARY KEY, event_name TEXT NOT NULL DEFAULT '', "
    "lead_b24_id INTEGER, payload JSONB NOT NULL DEFAULT '{}'::jsonb, "
    "created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
)


async def pool():
    global _pool
    if _pool is None:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise HTTPException(status_code=503, detail="DATABASE_URL is not set")
        _pool = await asyncpg.create_pool(clean_dsn(url), min_size=0, max_size=3)
        # self-provisioning: no manual SQL needed on a fresh database
        for schema in SCHEMAS:
            await _pool.execute(schema)
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


@app.post("/lead")
async def create_lead(request: Request):
    """Public lead form endpoint (RF-localization variant): validated and passed
    straight to Bitrix24 CRM (bitrix24.ru cloud, data stored in Russia). Personal
    data does not touch the foreign DB or queue — drafts never contain it anyway.
    If the CRM is unreachable the client gets an honest 503 and can retry."""
    if rate_limited(client_ip(request), limit=5):
        raise HTTPException(status_code=429, detail="too many requests")
    body = await request.body()
    if len(body) > MAX_LEAD_BODY:
        raise HTTPException(status_code=413, detail="lead too large")
    try:
        data = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="body must be valid JSON")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    if data.get("website"):
        # honeypot: bots fill hidden fields, humans cannot — pretend 400
        raise HTTPException(status_code=400, detail="bad request")
    name = " ".join(str(data.get("name") or "").split())
    contact = " ".join(str(data.get("contact") or "").split())
    message = " ".join(str(data.get("message") or "").split())
    if not name or len(name) > LEAD_NAME_MAX or not contact or len(contact) > LEAD_CONTACT_MAX:
        raise HTTPException(status_code=400, detail="name and contact are required")
    if len(message) > LEAD_MSG_MAX:
        raise HTTPException(status_code=400, detail="message too long")
    if data.get("consent") is not True:
        raise HTTPException(status_code=400, detail="consent required")
    webhook = os.environ.get("B24_WEBHOOK_URL", "")
    if not webhook:
        raise HTTPException(status_code=503, detail="crm temporarily unavailable")
    try:
        resp = requests.post(
            webhook.rstrip("/") + "/crm.lead.add",
            json={"fields": {
                "NAME": name,
                "COMMENTS": f"{contact}\n{message}".strip(),
                "SOURCE_DESCRIPTION": "do-offera.ru",
                "OPENED": "Y",
            }},
            timeout=20,
        )
        resp.raise_for_status()
        b24_id = int(resp.json()["result"])
    except (requests.RequestException, ValueError, KeyError):
        raise HTTPException(status_code=503, detail="crm temporarily unavailable")
    # best-effort operator ping without personal data: details live in the CRM
    try:
        token = os.environ.get("TG_BOT_TOKEN", "")
        chat = os.environ.get("TG_CHAT_ID", "")
        if token and chat:
            requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat, "text": f"Новая заявка с сайта — лид №{b24_id} в CRM Б24."},
                timeout=10,
            )
    except requests.RequestException:
        pass
    return {"ok": True, "id": b24_id}


@app.get("/lead/{lead_id}")
async def get_lead(lead_id: int, request: Request):
    if rate_limited(client_ip(request)):
        raise HTTPException(status_code=429, detail="too many requests")
    p = await pool()
    row = await p.fetchrow(
        "SELECT id, status, b24_lead_id, created_at FROM leads WHERE id = $1",
        lead_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="lead not found")
    return {
        "id": row["id"],
        "status": row["status"],
        "b24_lead_id": row["b24_lead_id"],
        "created_at": row["created_at"].isoformat(),
    }


@app.post("/b24/event")
async def b24_event(request: Request):
    """Bitrix24 outbound webhook receiver: lead stage changes land in lead_events."""
    secret = os.environ.get("B24_EVENT_SECRET", "")
    if not secret or request.query_params.get("secret") != secret:
        raise HTTPException(status_code=403, detail="forbidden")
    body = await request.body()
    try:
        data = json.loads(body)
    except ValueError:
        data = {"raw": body.decode("utf-8", "replace")[:2000]}
    event = str((data or {}).get("event") or "")[:80]
    fields = ((data or {}).get("data") or {}).get("FIELDS") or {}
    bid = fields.get("ID") or fields.get("id")
    lead_b24_id = int(bid) if isinstance(bid, str) and bid.isdigit() else (
        bid if isinstance(bid, int) else None)
    p = await pool()
    await p.execute(
        "INSERT INTO lead_events (event_name, lead_b24_id, payload) VALUES ($1, $2, $3)",
        event, lead_b24_id, json.dumps(data, ensure_ascii=False)[:4000],
    )
    return {"ok": True}

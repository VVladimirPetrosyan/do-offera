"""Celery worker for the do-offera lead pipeline.

The lead row is written by the web API (source of truth); this worker only
fan-outs: crm.lead.add in Bitrix24 (inbound webhook URL from env) and a
best-effort Telegram notification to the owner's channel. If Bitrix24 is
down, the task retries with backoff — the lead row is never lost.

Secrets (B24_WEBHOOK_URL, TG_BOT_TOKEN, REDIS_URL) live only in the
platform's environment variables, never in git.
"""
import asyncio
import os

import asyncpg
import requests
from celery import Celery
from celery.signals import worker_ready

from db import clean_dsn

B24_WEBHOOK_URL = os.environ.get("B24_WEBHOOK_URL", "")
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "")
TG_CHAT_ID = os.environ.get("TG_CHAT_ID", "")
REDIS_URL = os.environ.get("REDIS_URL", "")

celery_app = Celery("dooffera", broker=REDIS_URL or "redis://localhost:6379/0")
celery_app.conf.task_default_queue = "dooffera"


async def _fetch_lead(lead_id: int):
    conn = await asyncpg.connect(clean_dsn(os.environ["DATABASE_URL"]))
    try:
        return await conn.fetchrow(
            "SELECT id, name, contact, message, status, b24_lead_id "
            "FROM leads WHERE id = $1",
            lead_id,
        )
    finally:
        await conn.close()


async def _mark_lead(lead_id: int, status: str, b24_lead_id):
    conn = await asyncpg.connect(clean_dsn(os.environ["DATABASE_URL"]))
    try:
        await conn.execute(
            "UPDATE leads SET status = $1, b24_lead_id = $2 WHERE id = $3",
            status, b24_lead_id, lead_id,
        )
    finally:
        await conn.close()


def _b24_add_lead(lead) -> int:
    """crm.lead.add via the inbound webhook; raises RequestException on failure."""
    resp = requests.post(
        B24_WEBHOOK_URL.rstrip("/") + "/crm.lead.add",
        json={"fields": {
            "NAME": lead["name"],
            "COMMENTS": f"{lead['contact']}\n{lead['message']}".strip(),
            "SOURCE_DESCRIPTION": "do-offera.ru",
            "OPENED": "Y",
        }},
        timeout=20,
    )
    resp.raise_for_status()
    return int(resp.json()["result"])


def _tg_notify(text: str) -> None:
    requests.post(
        f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage",
        json={"chat_id": TG_CHAT_ID, "text": text},
        timeout=20,
    )


@celery_app.task(bind=True, max_retries=5, retry_backoff=True,
                 autoretry_for=(requests.RequestException,))
def sync_lead(self, lead_id: int):
    lead = asyncio.run(_fetch_lead(lead_id))
    if not lead:
        return f"lead {lead_id}: missing"
    status = lead["status"]
    b24_id = lead["b24_lead_id"]
    if b24_id:  # already synced — the retry landed after a slow success
        status = "synced"
    elif B24_WEBHOOK_URL:
        b24_id = _b24_add_lead(lead)  # RequestException here -> autoretry
        status = "synced"
        asyncio.run(_mark_lead(lead_id, status, b24_id))
    else:
        status = "b24_skipped"  # integration flag off: keep the lead, skip CRM
        asyncio.run(_mark_lead(lead_id, status, None))
    if TG_BOT_TOKEN and TG_CHAT_ID:
        try:
            _tg_notify(f"Заявка №{lead_id}: {lead['name']} — {lead['contact']}\n"
                       f"{lead['message'][:200]}")
        except requests.RequestException:
            pass  # best-effort: the lead itself is already saved and synced
    return f"lead {lead_id}: {status}"


@celery_app.task
def rescan_pending():
    """Dispatch sync for leads that never got queued (broker hiccup guard)."""
    rows = asyncio.run(_rescan_rows())
    for lead_id in rows:
        sync_lead.delay(lead_id)
    return f"dispatched {len(rows)}"


async def _rescan_rows():
    conn = await asyncpg.connect(clean_dsn(os.environ["DATABASE_URL"]))
    try:
        rows = await conn.fetch(
            "SELECT id FROM leads WHERE status = 'new' ORDER BY id LIMIT 50")
    finally:
        await conn.close()
    return [r["id"] for r in rows]


@worker_ready.connect
def _rescan_on_start(sender=None, **kwargs):
    rescan_pending.delay()

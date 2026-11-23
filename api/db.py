"""Shared DSN handling for the do-offera API and the Celery worker."""
import re


def clean_dsn(url: str) -> str:
    """Make a Neon DSN acceptable to asyncpg: postgresql:// scheme, no channel_binding."""
    url = url.replace("postgres://", "postgresql://", 1)
    return re.sub(r"[?&]channel_binding=require", "", url)

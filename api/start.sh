#!/bin/sh
# One free Render service runs both the worker and the web app:
# the worker starts in the background, uvicorn stays in the foreground.
celery -A tasks worker --loglevel=info --concurrency=1 &
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8080}"

# One image for every Vizual background worker. Choose the process with WORKER
# (see start.sh). On Railway create one service per worker from this directory
# (root directory: apps/worker) and set WORKER=rss / WORKER=page_change.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Baku

RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY start.sh ./start.sh
COPY rss ./rss
COPY page_change ./page_change

# Workers write small state files (site_health.json, telegram_offset.json) next
# to their code, so the app user needs write access to its own directories.
RUN useradd --create-home --uid 10001 worker \
    && chmod +x /app/start.sh \
    && chown -R worker:worker /app/rss /app/page_change
USER worker

CMD ["/app/start.sh"]

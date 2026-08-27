# MLB Market Value — API + Dashboard image
# Multi-service stack is orchestrated by docker-compose.yml (db + api).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Build-time toolchain for any wheels that need compiling (psycopg2, numpy,
# pandas, scipy, lxml all ship manylinux wheels for cp313, so this is a safety
# net rather than a hard requirement).
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first so layer caching kicks in on code changes.
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt

# Application code + the dashboard frontend (template, fonts, build module).
COPY backend /app/backend
COPY frontend/dashboard /app/frontend/dashboard

WORKDIR /app/backend

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD curl -fsS http://localhost:8000/health || exit 1

# Entrypoint runs migrations + conditional ingest + dashboard build, then boots
# the API (which serves the dashboard at /). Season defaults to the current
# year; docker-compose.yml can override args (e.g. --season / --history-seasons).
# `--migrate-only` exits after migrations for a one-shot init job.
CMD ["python", "-m", "app.pipeline.run_all", "--history-seasons", "3"]

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1000 app \
    && useradd  --system --uid 1000 --gid app --home /srv --shell /sbin/nologin app

WORKDIR /srv

COPY --chown=app:app requirements.txt .
RUN pip install -r requirements.txt

# Copy the whole app package under /srv/app so `app.wsgi:app` resolves.
COPY --chown=app:app . ./app/

USER app

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD ["curl", "-fsS", "http://localhost:8080/healthz"]

CMD ["gunicorn", \
     "--chdir", "/srv", \
     "--bind", "0.0.0.0:8080", \
     "--worker-class", "gevent", \
     "--workers", "2", \
     "--worker-connections", "500", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "app.wsgi:app"]

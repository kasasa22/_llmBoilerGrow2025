"""POST /api/chat — the ingress endpoint.

Contract (see plan B1 Idempotency for the full spec):

- Body: ``{"query": str, "max_steps"?: int, "model"?: str}``.
- Optional header ``Idempotency-Key: <8..128 chars, [A-Za-z0-9._~-]>``.
- 202 on fresh: ``{job_id, stream_url, status_url, idempotent: false}``.
- 200 on dedup hit: same body with ``idempotent: true`` + header
  ``Idempotency-Status: replayed``.
- 409 when Idempotency-Key reused with different body.
- 400 on malformed key or bad body.

Every response carries the ``x-trace-id`` header.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from flask import Blueprint, jsonify, request

from app.config import get_settings
from app.idempotency import (
    compute_body_hash,
    compute_request_hash,
    is_valid_idempotency_key,
)
from app.inngest_client import send_research_query
from app.redis_bus import get_bus
from app.trace import (
    JOB_ID_VAR,
    TRACE_ID_VAR,
    new_job_id,
    new_span_id,
    new_trace_id,
    now_iso,
)

log = logging.getLogger(__name__)

bp = Blueprint("chat", __name__)


@bp.get("/api/jobs/<job_id>")
def get_job(job_id: str):
    status = get_bus().get_status(job_id)
    trace_id = _bind_trace(job_id=job_id)
    resp = jsonify(status or {"error": "not_found", "job_id": job_id})
    resp.headers[get_settings().trace_id_header] = trace_id
    return resp, (200 if status else 404)


@bp.post("/api/chat")
def submit_chat():
    cfg = get_settings()
    trace_id = _bind_trace()

    raw_body = request.get_data(cache=False, as_text=False) or b""
    try:
        payload = json.loads(raw_body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, ValueError):
        return _err(400, "bad_request", "body must be JSON", trace_id)

    query = payload.get("query")
    if not isinstance(query, str) or not query.strip():
        return _err(400, "bad_request", "'query' is required and must be a non-empty string", trace_id)
    if len(query) > cfg.request_max_query_chars:
        return _err(400, "bad_request", f"'query' exceeds {cfg.request_max_query_chars} chars", trace_id)

    max_steps = payload.get("max_steps")
    if max_steps is not None and (not isinstance(max_steps, int) or max_steps <= 0 or max_steps > 20):
        return _err(400, "bad_request", "'max_steps' must be an int in [1, 20]", trace_id)

    model = payload.get("model")
    if model is not None and (not isinstance(model, str) or not model.strip()):
        return _err(400, "bad_request", "'model' must be a non-empty string when provided", trace_id)

    idem_header = request.headers.get("Idempotency-Key")
    if idem_header is not None and not is_valid_idempotency_key(idem_header):
        return _err(400, "invalid_idempotency_key", "Idempotency-Key must match ^[A-Za-z0-9._~-]{8,128}$", trace_id)

    request_hash = compute_request_hash(query, idem_header)
    body_hash = compute_body_hash(raw_body)

    bus = get_bus()
    provisional_job_id = new_job_id()
    fresh, existing_job, existing_body = bus.try_claim_request_hash(
        request_hash=request_hash,
        job_id=provisional_job_id,
        body_sha=body_hash,
        ttl_seconds=cfg.idempotency_ttl_seconds,
    )

    if not fresh:
        if idem_header and existing_body and existing_body != body_hash:
            return _err(409, "idempotency_key_reuse",
                        "Idempotency-Key already used for a different request",
                        trace_id, extra_headers={"Idempotency-Status": "conflict"})

        job_id = existing_job or provisional_job_id
        JOB_ID_VAR.set(job_id)
        log.info("chat.dedup.hit", extra={"job_id": job_id, "request_hash": request_hash})
        return _job_response(
            job_id=job_id, trace_id=trace_id, http_status=200,
            idempotent=True, idempotency_status="replayed",
        )

    job_id = provisional_job_id
    JOB_ID_VAR.set(job_id)
    submitted_at = now_iso()

    bus.set_status(
        job_id=job_id,
        patch={
            "state": "queued",
            "trace_id": trace_id,
            "request_hash": request_hash,
            "created_at": submitted_at,
            "model": model or cfg.model_name,
        },
        ttl_seconds=cfg.job_status_ttl_seconds,
    )

    try:
        send_research_query(
            job_id=job_id,
            trace_id=trace_id,
            query=query,
            submitted_at=submitted_at,
            max_steps=max_steps,
            model=model,
        )
    except Exception:  # pragma: no cover - upstream network failure
        log.exception("chat.inngest.dispatch_failed", extra={"job_id": job_id})
        bus.set_status(job_id, {"state": "failed", "terminal_reason": "dispatch"}, cfg.job_status_ttl_seconds)
        return _err(502, "dispatch_failed", "could not enqueue research job", trace_id)

    log.info("chat.accepted", extra={"job_id": job_id, "request_hash": request_hash})
    return _job_response(
        job_id=job_id, trace_id=trace_id, http_status=202,
        idempotent=False, idempotency_status="created",
    )


def _bind_trace(job_id: str | None = None) -> str:
    trace_id = new_trace_id()
    TRACE_ID_VAR.set(trace_id)
    if job_id is not None:
        JOB_ID_VAR.set(job_id)
    from app.trace import SPAN_ID_VAR
    SPAN_ID_VAR.set(new_span_id())
    return trace_id


def _job_response(
    *,
    job_id: str,
    trace_id: str,
    http_status: int,
    idempotent: bool,
    idempotency_status: str,
):
    cfg = get_settings()
    body: dict[str, Any] = {
        "job_id": job_id,
        "stream_url": f"/api/jobs/{job_id}/stream",
        "status_url": f"/api/jobs/{job_id}",
        "idempotent": idempotent,
    }
    resp = jsonify(body)
    resp.headers[cfg.trace_id_header] = trace_id
    resp.headers["Idempotency-Status"] = idempotency_status
    return resp, http_status


def _err(status: int, code: str, message: str, trace_id: str, extra_headers: dict[str, str] | None = None):
    cfg = get_settings()
    resp = jsonify({"error": code, "message": message})
    resp.headers[cfg.trace_id_header] = trace_id
    for header, value in (extra_headers or {}).items():
        resp.headers[header] = value
    return resp, status

"""GET /api/jobs/<id>/stream — SSE relay backed by Redis pub/sub.

Flow:
1. Emit any log-list backfill entries with seq > Last-Event-ID (or all).
2. If a terminal ``final`` sits in ``job:{id}:final``, publish it and close.
3. Otherwise subscribe to ``job:{id}:events`` and stream envelopes verbatim.
4. Emit a keep-alive comment every N seconds so Civo LB idle-timeout
   (~60s) doesn't kill the connection.

Assumes gevent-patched sockets so ``pubsub.get_message`` yields the greenlet.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Iterator

from flask import Blueprint, Response, request

from app.config import get_settings
from app.redis_bus import (
    decode_envelope,
    get_bus,
    job_events_channel,
)
from app.trace import JOB_ID_VAR, TRACE_ID_VAR, new_span_id, new_trace_id

log = logging.getLogger(__name__)

bp = Blueprint("stream", __name__)


@bp.get("/api/jobs/<job_id>/stream")
def stream(job_id: str):
    trace_id = new_trace_id()
    TRACE_ID_VAR.set(trace_id)
    JOB_ID_VAR.set(job_id)
    from app.trace import SPAN_ID_VAR
    SPAN_ID_VAR.set(new_span_id())

    last_event_id = _parse_last_event_id(request.headers.get("Last-Event-ID"))
    cfg = get_settings()

    response = Response(
        _generate(job_id=job_id, last_seq=last_event_id),
        mimetype="text/event-stream",
    )
    response.headers["Cache-Control"] = "no-cache, no-transform"
    response.headers["X-Accel-Buffering"] = "no"
    response.headers["Connection"] = "keep-alive"
    response.headers[cfg.trace_id_header] = trace_id
    return response


def _parse_last_event_id(raw: str | None) -> int:
    if not raw:
        return -1
    try:
        return int(raw)
    except (TypeError, ValueError):
        return -1


def _generate(*, job_id: str, last_seq: int) -> Iterator[bytes]:
    cfg = get_settings()
    bus = get_bus()

    yield b": stream open\n\n"

    seen_seqs: set[int] = set()

    for entry in bus.get_log_tail(job_id=job_id, max_entries=cfg.sse_replay_max):
        try:
            envelope = decode_envelope(entry)
        except ValueError:
            continue
        if envelope.seq is not None and envelope.seq <= last_seq:
            continue
        if envelope.seq is not None:
            seen_seqs.add(envelope.seq)
        yield _to_sse(envelope.raw, envelope.phase, envelope.seq)

    final_raw = bus.get_final(job_id)
    if final_raw:
        try:
            envelope = decode_envelope(final_raw)
            if envelope.seq is None or envelope.seq not in seen_seqs:
                yield _to_sse(envelope.raw, envelope.phase, envelope.seq)
            yield _to_sse(_synthetic_done_payload(job_id), "done", None)
            return
        except ValueError:
            log.warning("stream.final.decode_failed", extra={"job_id": job_id})

    # Live subscribe. Use pubsub with a poll timeout so we can emit keepalives.
    pubsub = bus._pubsub_client.pubsub(ignore_subscribe_messages=True)  # noqa: SLF001
    pubsub.subscribe(job_events_channel(job_id))
    try:
        while True:
            message = pubsub.get_message(timeout=cfg.sse_keepalive_seconds)
            if message is None:
                yield b": keep-alive\n\n"
                continue
            if message.get("type") != "message":
                continue
            raw = message.get("data")
            if not isinstance(raw, str):
                continue
            try:
                envelope = decode_envelope(raw)
            except ValueError:
                continue
            if envelope.seq is not None:
                if envelope.seq in seen_seqs:
                    continue
                seen_seqs.add(envelope.seq)
            yield _to_sse(envelope.raw, envelope.phase, envelope.seq)
            if envelope.phase in ("done", "error") and envelope.data.get("terminal") is not False:
                return
    finally:
        try:
            pubsub.unsubscribe()
            pubsub.close()
        except Exception:  # pragma: no cover
            log.debug("stream.pubsub.close_failed", exc_info=True)


def _to_sse(raw_json: str, phase: str, seq: int | None) -> bytes:
    parts = []
    if seq is not None:
        parts.append(f"id: {seq}\n")
    parts.append(f"event: {phase}\n")
    for line in raw_json.splitlines() or [""]:
        parts.append(f"data: {line}\n")
    parts.append("\n")
    return "".join(parts).encode("utf-8")


def _synthetic_done_payload(job_id: str) -> str:
    payload: dict[str, Any] = {
        "phase": "done",
        "job_id": job_id,
        "data": {"reason": "replay_of_final"},
    }
    return json.dumps(payload, separators=(",", ":"))

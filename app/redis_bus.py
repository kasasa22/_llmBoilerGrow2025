"""Redis-backed pub/sub bus and job-state store.

Central to the SSE fan-out story: the worker publishes envelopes to
``job:{id}:events`` and mirrors them into ``job:{id}:log`` (capped list) so
late subscribers can replay. Flask subscribes for live streaming and pulls
the replay list on connect.

Key layout is the source of truth documented in the plan file (B1 idempotency
section). Keep names aligned with the worker's ``src/events.ts``.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Iterator

import redis

from app.config import get_settings

log = logging.getLogger(__name__)


def _redis_key(*parts: str) -> str:
    return ":".join(parts)


def job_events_channel(job_id: str) -> str:
    return _redis_key("job", job_id, "events")


def job_log_key(job_id: str) -> str:
    return _redis_key("job", job_id, "log")


def job_status_key(job_id: str) -> str:
    return _redis_key("job", job_id, "status")


def job_final_key(job_id: str) -> str:
    return _redis_key("job", job_id, "final")


def job_seq_key(job_id: str) -> str:
    return _redis_key("job", job_id, "seq")


def job_hash_key(request_hash: str) -> str:
    return _redis_key("job", "hash", request_hash)


def job_hash_body_key(request_hash: str) -> str:
    return _redis_key("job", "hash", request_hash, "body")


@dataclass(frozen=True, slots=True)
class BusEvent:
    """Decoded envelope pulled from Redis pub/sub or the replay log."""

    seq: int | None
    phase: str
    trace_id: str | None
    job_id: str | None
    span_id: str | None
    parent_span_id: str | None
    ts: str | None
    data: dict[str, Any]
    raw: str  # Original JSON for verbatim SSE relay.


class RedisBus:
    """Thin wrapper. Two Redis connections: one for pubsub, one for KV."""

    def __init__(self, url: str | None = None) -> None:
        cfg = get_settings()
        self._url = url or cfg.redis_url
        # decode_responses=True so we get str back from GET/HGETALL; SUBSCRIBE
        # payloads are also str-decoded.
        self._client: redis.Redis = redis.Redis.from_url(
            self._url, decode_responses=True, socket_keepalive=True
        )
        self._pubsub_client: redis.Redis = redis.Redis.from_url(
            self._url, decode_responses=True, socket_keepalive=True
        )

    # ---- health --------------------------------------------------------
    def ping(self) -> bool:
        try:
            return bool(self._client.ping())
        except redis.RedisError:
            return False

    # ---- status hash ---------------------------------------------------
    def set_status(self, job_id: str, patch: dict[str, Any], ttl_seconds: int) -> None:
        key = job_status_key(job_id)
        pipeline = self._client.pipeline()
        pipeline.hset(key, mapping={k: _to_redis(v) for k, v in patch.items()})
        pipeline.expire(key, ttl_seconds)
        pipeline.execute()

    def get_status(self, job_id: str) -> dict[str, Any] | None:
        raw = self._client.hgetall(job_status_key(job_id))
        if not raw:
            return None
        return {k: _from_redis(v) for k, v in raw.items()}

    # ---- idempotency ---------------------------------------------------
    def try_claim_request_hash(
        self, request_hash: str, job_id: str, body_sha: str, ttl_seconds: int
    ) -> tuple[bool, str | None, str | None]:
        """Attempt to bind request_hash -> job_id.

        Returns (fresh, existing_job_id_or_none, existing_body_sha_or_none).
        """
        key = job_hash_key(request_hash)
        body_key = job_hash_body_key(request_hash)
        pipeline = self._client.pipeline()
        pipeline.set(key, job_id, nx=True, ex=ttl_seconds)
        pipeline.set(body_key, body_sha, nx=True, ex=ttl_seconds)
        set_ok, _body_ok = pipeline.execute()
        if set_ok:
            return True, None, None
        existing_job = self._client.get(key)
        existing_body = self._client.get(body_key)
        return False, existing_job, existing_body

    # ---- final replay --------------------------------------------------
    def get_final(self, job_id: str) -> str | None:
        return self._client.get(job_final_key(job_id))

    def get_log_tail(self, job_id: str, max_entries: int = 500) -> list[str]:
        """Return the replay log oldest-first."""
        entries = self._client.lrange(job_log_key(job_id), 0, max_entries - 1) or []
        return list(reversed(entries))

    # ---- subscribe -----------------------------------------------------
    def subscribe(self, job_id: str) -> Iterator[str]:
        """Yield raw JSON messages for a job. Caller decides when to stop."""
        pubsub = self._pubsub_client.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(job_events_channel(job_id))
        try:
            for message in pubsub.listen():
                if message is None:
                    continue
                if message.get("type") != "message":
                    continue
                payload = message.get("data")
                if isinstance(payload, str):
                    yield payload
        finally:
            try:
                pubsub.unsubscribe()
                pubsub.close()
            except Exception:  # pragma: no cover - close is best-effort
                log.debug("pubsub close failed", exc_info=True)


def decode_envelope(raw: str) -> BusEvent:
    payload: dict[str, Any] = json.loads(raw)
    return BusEvent(
        seq=_maybe_int(payload.get("seq")),
        phase=str(payload.get("phase", "unknown")),
        trace_id=payload.get("trace_id"),
        job_id=payload.get("job_id"),
        span_id=payload.get("span_id"),
        parent_span_id=payload.get("parent_span_id"),
        ts=payload.get("ts"),
        data=payload.get("data", {}) or {},
        raw=raw,
    )


def _to_redis(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, separators=(",", ":"))


def _from_redis(value: str) -> Any:
    if not value:
        return value
    if value[0] in "{[\"" or value in {"true", "false", "null"}:
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def _maybe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


_singleton: RedisBus | None = None


def get_bus() -> RedisBus:
    global _singleton
    if _singleton is None:
        _singleton = RedisBus()
    return _singleton

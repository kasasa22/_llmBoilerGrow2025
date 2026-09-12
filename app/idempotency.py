"""Ingress idempotency for POST /api/chat.

Two-layer dedup:

1. **Request hash** — sha256 of the normalized query (optionally salted by
   an ``Idempotency-Key`` header) binds identical retries to the same job.
2. **Body hash** — sha256 of the full request body catches the case where a
   client reuses an Idempotency-Key for a genuinely different request; that
   surfaces as HTTP 409 rather than a silent dedup.

Interview theme (Katlego): explicit outbox-lite. See ADR-007.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

# RFC 7807-ish token spec: unreserved + safe punctuation, bounded length.
IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._~-]{8,128}$")

# Collapse runs of whitespace so trivially-different retries hash the same.
_WS_RE = re.compile(r"\s+")


def normalize_query(query: str) -> str:
    return _WS_RE.sub(" ", query.strip()).lower()


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_request_hash(query: str, idempotency_key: str | None) -> str:
    inner = _sha256(normalize_query(query))
    if idempotency_key:
        return _sha256(f"{inner}:{idempotency_key}")
    return inner


def compute_body_hash(body_bytes: bytes) -> str:
    return hashlib.sha256(body_bytes).hexdigest()


def is_valid_idempotency_key(value: str | None) -> bool:
    return bool(value and IDEMPOTENCY_KEY_RE.match(value))


IdempotencyStatus = Literal["created", "replayed", "conflict", "invalid_key"]


@dataclass(frozen=True, slots=True)
class IdempotencyDecision:
    """Result of the ingress dedup check for POST /api/chat.

    - ``status="created"``: fresh submission, caller proceeds to send the
      Inngest event and returns HTTP 202.
    - ``status="replayed"``: dedup hit; caller returns HTTP 200 with the
      existing job_id and points the client at the same stream URL.
    - ``status="conflict"``: same Idempotency-Key but different body; caller
      returns HTTP 409.
    - ``status="invalid_key"``: malformed Idempotency-Key header; HTTP 400.
    """

    status: IdempotencyStatus
    job_id: str | None
    request_hash: str | None
    body_hash: str | None

"""Distributed-tracing envelope for the request lifecycle.

trace_id is a per-request 32-hex identifier minted in Flask on POST /api/chat
and threaded through the Inngest event payload, the worker's Redis publishes,
and every log line. Kept distinct from job_id so we can rotate/scrub one
without affecting the other, and shaped like W3C traceparent so a future
OpenTelemetry PR needs no field renames.
"""
from __future__ import annotations

import secrets
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


TRACE_ID_VAR: ContextVar[str | None] = ContextVar("trace_id", default=None)
JOB_ID_VAR: ContextVar[str | None] = ContextVar("job_id", default=None)
SPAN_ID_VAR: ContextVar[str | None] = ContextVar("span_id", default=None)
PARENT_SPAN_ID_VAR: ContextVar[str | None] = ContextVar("parent_span_id", default=None)


def new_trace_id() -> str:
    return secrets.token_hex(16)


def new_job_id() -> str:
    return "job_" + secrets.token_hex(6)


def new_span_id() -> str:
    return secrets.token_hex(8)


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class TraceCtx:
    trace_id: str
    job_id: str | None = None
    span_id: str | None = None
    parent_span_id: str | None = None

    def bind(self) -> None:
        TRACE_ID_VAR.set(self.trace_id)
        JOB_ID_VAR.set(self.job_id)
        SPAN_ID_VAR.set(self.span_id)
        PARENT_SPAN_ID_VAR.set(self.parent_span_id)


def current() -> dict[str, Any]:
    """Snapshot of the current trace context, for log records and event envelopes."""
    return {
        "trace_id": TRACE_ID_VAR.get(),
        "job_id": JOB_ID_VAR.get(),
        "span_id": SPAN_ID_VAR.get(),
        "parent_span_id": PARENT_SPAN_ID_VAR.get(),
    }

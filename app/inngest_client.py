"""Inngest event dispatcher for Flask.

Flask never runs Inngest functions itself — it only sends the
``research/query.submitted`` event carrying job_id + trace_id + query. The
Node/TS worker owns the actual function definitions.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import inngest

from app.config import get_settings

log = logging.getLogger(__name__)

RESEARCH_QUERY_EVENT = "research/query.submitted"


@lru_cache(maxsize=1)
def get_client() -> inngest.Inngest:
    cfg = get_settings()
    kwargs: dict[str, Any] = {
        "app_id": cfg.inngest_app_id,
        "is_production": cfg.env == "prod",
    }
    if cfg.inngest_event_key:
        kwargs["event_key"] = cfg.inngest_event_key
    if cfg.inngest_signing_key:
        kwargs["signing_key"] = cfg.inngest_signing_key
    if cfg.inngest_base_url:
        kwargs["api_base_url"] = cfg.inngest_base_url
    return inngest.Inngest(**kwargs)


def send_research_query(
    *,
    job_id: str,
    trace_id: str,
    query: str,
    submitted_at: str,
    max_steps: int | None = None,
    model: str | None = None,
) -> None:
    """Send the query.submitted event. Non-blocking wrt worker execution."""
    payload: dict[str, Any] = {
        "job_id": job_id,
        "trace_id": trace_id,
        "query": query,
        "submitted_at": submitted_at,
    }
    if max_steps is not None:
        payload["max_steps"] = max_steps
    if model:
        payload["model"] = model

    get_client().send_sync(
        inngest.Event(name=RESEARCH_QUERY_EVENT, data=payload)
    )
    log.info(
        "inngest.event.sent",
        extra={"event": RESEARCH_QUERY_EVENT, "job_id": job_id, "trace_id": trace_id},
    )

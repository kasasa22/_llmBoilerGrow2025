"""Deterministic scoring for one eval case's SSE transcript.

Metrics are pure functions of (case, transcript) so the same run is
replayable. `citations_from_expected_domains` uses tldextract for a
correct eTLD+1 match; substring matching would over-count.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import tldextract


@dataclass(slots=True)
class CaseResult:
    id: str
    query: str
    has_final_answer: bool
    tool_calls: int
    fetches: int
    searches: int
    citations_count: int
    expected_domain_hit: float  # 0..1
    facts_hit: float  # 0..1
    wall_clock_ms: int
    budget_hits: int
    errors: int
    partial: bool
    terminated: bool


def _iter_data(transcript: list[dict[str, Any]], phase: str) -> Iterable[dict[str, Any]]:
    for env in transcript:
        if env.get("phase") == phase:
            yield env.get("data") or {}


def _first_ts(transcript: list[dict[str, Any]]) -> int:
    for env in transcript:
        ts = env.get("ts")
        if ts:
            return _parse_ts_ms(ts)
    return 0


def _last_ts(transcript: list[dict[str, Any]]) -> int:
    for env in reversed(transcript):
        ts = env.get("ts")
        if ts:
            return _parse_ts_ms(ts)
    return 0


def _parse_ts_ms(ts: str) -> int:
    # ISO8601 with milliseconds → ms since epoch. Tolerant of trailing 'Z'.
    from datetime import datetime, timezone

    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp() * 1000)
    except ValueError:
        return 0


def _domain_of(url: str) -> str:
    ex = tldextract.extract(url)
    return ".".join(p for p in (ex.domain, ex.suffix) if p)


def score_case(case: dict[str, Any], transcript: list[dict[str, Any]]) -> CaseResult:
    tool_called = list(_iter_data(transcript, "tool.called"))
    tool_calls = len(tool_called)
    fetches = sum(1 for d in tool_called if d.get("tool") == "fetchUrl")
    searches = sum(1 for d in tool_called if d.get("tool") == "webSearch")

    final_events = list(_iter_data(transcript, "final"))
    final = final_events[-1] if final_events else {}
    has_final = bool(final.get("answer"))
    partial = bool(final.get("partial"))
    citations = final.get("citations") or []
    answer_text: str = str(final.get("answer") or "")

    expected_sources: list[str] = case.get("expected_sources", []) or []
    if expected_sources:
        cited_domains = {_domain_of(c.get("url", "")) for c in citations if c.get("url")}
        matched = sum(1 for d in cited_domains if any(d.endswith(exp) for exp in expected_sources))
        expected_domain_hit = matched / max(1, len(expected_sources))
    else:
        expected_domain_hit = 1.0

    expected_facts: list[str] = case.get("expected_facts", []) or []
    if expected_facts and answer_text:
        low = answer_text.lower()
        hits = sum(1 for f in expected_facts if f.lower() in low)
        facts_hit = hits / len(expected_facts)
    else:
        facts_hit = 1.0 if not expected_facts else 0.0

    return CaseResult(
        id=str(case.get("id", "?")),
        query=str(case.get("query", "")),
        has_final_answer=has_final,
        tool_calls=tool_calls,
        fetches=fetches,
        searches=searches,
        citations_count=len(citations),
        expected_domain_hit=round(expected_domain_hit, 3),
        facts_hit=round(facts_hit, 3),
        wall_clock_ms=max(0, _last_ts(transcript) - _first_ts(transcript)),
        budget_hits=len(list(_iter_data(transcript, "budget.hit"))),
        errors=len(list(_iter_data(transcript, "error"))) + len(list(_iter_data(transcript, "network.error"))),
        partial=partial,
        terminated=any(env.get("phase") == "done" for env in transcript) or has_final,
    )

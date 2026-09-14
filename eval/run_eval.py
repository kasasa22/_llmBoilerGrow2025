"""Async eval driver.

Reads eval/dataset.jsonl, POSTs each case to /api/chat on the target URL,
tails SSE via sseclient, scores the transcript, writes a rich CLI table + a
timestamped markdown report under eval/results/.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx
import sseclient  # type: ignore[import-untyped]

from scoring import CaseResult, score_case
from report import as_dicts, render_console, write_markdown


DEFAULT_CONCURRENCY = int(os.environ.get("EVAL_CONCURRENCY", "2"))


def _load_dataset(path: Path) -> list[dict[str, Any]]:
    cases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        cases.append(json.loads(line))
    return cases


def _consume_sse(url: str, timeout_s: int) -> list[dict[str, Any]]:
    """Blocking SSE tail; returns the list of decoded envelopes."""
    headers = {"accept": "text/event-stream"}
    resp = httpx.stream("GET", url, headers=headers, timeout=timeout_s)
    envelopes: list[dict[str, Any]] = []
    with resp as r:
        client = sseclient.SSEClient(r.iter_bytes())  # type: ignore[arg-type]
        for event in client.events():
            if event.event in ("done", "final") and not event.data:
                envelopes.append({"phase": event.event, "data": {}})
                if event.event == "done":
                    break
                continue
            try:
                payload = json.loads(event.data) if event.data else {}
            except json.JSONDecodeError:
                continue
            if event.event and "phase" not in payload:
                payload["phase"] = event.event
            envelopes.append(payload)
            if payload.get("phase") == "done":
                break
    return envelopes


async def _run_one(case: dict[str, Any], base_url: str) -> CaseResult:
    async with httpx.AsyncClient(timeout=30) as client:
        body = {"query": case["query"]}
        resp = await client.post(f"{base_url}/api/chat", json=body, headers={"content-type": "application/json"})
        resp.raise_for_status()
        data = resp.json()
        job_id = data["job_id"]

    timeout_s = int(case.get("timeout_s") or int(os.environ.get("EVAL_TIMEOUT_S", "600")))
    loop = asyncio.get_event_loop()
    transcript = await loop.run_in_executor(
        None, _consume_sse, f"{base_url}/api/jobs/{job_id}/stream", timeout_s
    )
    return score_case(case, transcript)


async def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("EVAL_URL", "http://localhost:8080"))
    ap.add_argument("--dataset", default="eval/dataset.jsonl")
    ap.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    ap.add_argument("--out", default=None)
    ap.add_argument("--fail-under", type=float, default=float(os.environ.get("EVAL_FAIL_UNDER", "0.5")))
    args = ap.parse_args(argv)

    cases = _load_dataset(Path(args.dataset))
    if not cases:
        print(f"no cases in {args.dataset}", file=sys.stderr)
        return 2

    sem = asyncio.Semaphore(args.concurrency)

    async def _bounded(c: dict[str, Any]) -> CaseResult:
        async with sem:
            try:
                return await _run_one(c, args.url.rstrip("/"))
            except Exception as err:  # noqa: BLE001
                print(f"case {c.get('id')} errored: {err}", file=sys.stderr)
                return CaseResult(
                    id=str(c.get("id", "?")),
                    query=str(c.get("query", "")),
                    has_final_answer=False,
                    tool_calls=0, fetches=0, searches=0,
                    citations_count=0,
                    expected_domain_hit=0.0, facts_hit=0.0,
                    wall_clock_ms=0, budget_hits=0, errors=1,
                    partial=False, terminated=False,
                )

    results: list[CaseResult] = await asyncio.gather(*(_bounded(c) for c in cases))
    render_console(results)

    if args.out:
        write_markdown(
            list(results),
            Path(args.out),
            meta={
                "url": args.url,
                "cases": str(len(cases)),
                "generated_at": os.popen("date -u +%FT%TZ").read().strip(),
            },
        )
        print(f"wrote {args.out}")

    # Fail gate: mean citations_from_expected_domains
    if results:
        mean_dom = sum(r.expected_domain_hit for r in results) / len(results)
        print(f"mean citations_from_expected_domains = {mean_dom:.3f} (threshold {args.fail_under})")
        if mean_dom < args.fail_under:
            print("FAIL: below threshold", file=sys.stderr)
            return 1
    return 0


def main() -> int:
    return asyncio.run(_main(sys.argv[1:]))


if __name__ == "__main__":
    sys.exit(main())

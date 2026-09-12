"""Rich CLI + markdown report writer for eval results."""
from __future__ import annotations

import statistics
from dataclasses import asdict
from pathlib import Path
from typing import Iterable

from rich.console import Console
from rich.table import Table

from scoring import CaseResult


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def render_console(results: Iterable[CaseResult]) -> None:
    console = Console()
    table = Table(title="Eval results", show_lines=False)
    for header, style in [
        ("id", "cyan"),
        ("query", "white"),
        ("tools", "magenta"),
        ("fetches", "magenta"),
        ("cit", "green"),
        ("dom", "green"),
        ("facts", "green"),
        ("ms", "yellow"),
        ("final", "bold"),
        ("budget", "yellow"),
        ("errors", "red"),
    ]:
        table.add_column(header, style=style, no_wrap=header != "query")
    for r in results:
        table.add_row(
            r.id,
            _clip(r.query, 60),
            str(r.tool_calls),
            str(r.fetches),
            str(r.citations_count),
            f"{r.expected_domain_hit:.2f}",
            f"{r.facts_hit:.2f}",
            str(r.wall_clock_ms),
            "yes" if r.has_final_answer else "-",
            str(r.budget_hits),
            str(r.errors),
        )
    console.print(table)


def _mean(values: list[float]) -> float:
    return round(statistics.fmean(values), 3) if values else 0.0


def _median(values: list[float]) -> float:
    return round(statistics.median(values), 3) if values else 0.0


def write_markdown(results: list[CaseResult], out_path: Path, *, meta: dict[str, str]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tool_calls = [float(r.tool_calls) for r in results]
    wall_ms = [float(r.wall_clock_ms) for r in results]
    dom = [r.expected_domain_hit for r in results]
    facts = [r.facts_hit for r in results]
    has_final = sum(1 for r in results if r.has_final_answer)
    budget = sum(r.budget_hits for r in results)
    errors = sum(r.errors for r in results)

    header = (
        "# Eval report\n\n"
        + "".join(f"- **{k}**: {v}\n" for k, v in meta.items())
        + "\n"
    )
    aggregate = (
        "## Aggregate\n\n"
        f"- cases: **{len(results)}**\n"
        f"- has_final_answer: **{has_final}/{len(results)}**\n"
        f"- tool_calls (mean/median): {_mean(tool_calls)} / {_median(tool_calls)}\n"
        f"- wall_clock_ms (mean/median): {int(_mean(wall_ms))} / {int(_median(wall_ms))}\n"
        f"- citations_from_expected_domains (mean): **{_mean(dom)}**\n"
        f"- expected_facts_hit (mean): {_mean(facts)}\n"
        f"- budget_hits (total): {budget}\n"
        f"- errors (total): {errors}\n\n"
    )
    table_head = (
        "## Per-case\n\n"
        "| id | query | tools | fetches | citations | domain_hit | facts_hit | wall_ms | final | budget | errors |\n"
        "|----|-------|-------|---------|-----------|------------|-----------|---------|-------|--------|--------|\n"
    )
    rows = []
    for r in results:
        query_short = _clip(r.query, 90).replace("|", "\\|")
        rows.append(
            f"| {r.id} | {query_short} | {r.tool_calls} | {r.fetches} | {r.citations_count} "
            f"| {r.expected_domain_hit:.2f} | {r.facts_hit:.2f} | {r.wall_clock_ms} "
            f"| {'yes' if r.has_final_answer else '-'} | {r.budget_hits} | {r.errors} |"
        )
    out_path.write_text(header + aggregate + table_head + "\n".join(rows) + "\n", encoding="utf-8")


def as_dicts(results: list[CaseResult]) -> list[dict]:
    return [asdict(r) for r in results]

"""JSON structured logging with trace context on every record.

Every log line carries `trace_id`, `job_id`, `span_id`, `parent_span_id` if
they are bound on the current context — so `kubectl logs deploy/app | jq
'select(.trace_id==$t)'` correlates cleanly with the worker's pino output.
"""
from __future__ import annotations

import logging
import sys
from typing import Any

from pythonjsonlogger.jsonlogger import JsonFormatter

from app.trace import current


class TraceInjectingFormatter(JsonFormatter):
    """JsonFormatter that also injects the current trace-context snapshot."""

    def add_fields(  # type: ignore[override]
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record.setdefault("logger", record.name)
        log_record.setdefault("level", record.levelname.lower())
        log_record.setdefault("ts", self.formatTime(record, self.datefmt))
        for key, value in current().items():
            if value is not None:
                log_record.setdefault(key, value)


def setup_logging(level: str = "info", include_stack: bool = False) -> None:
    """Reconfigure the root logger to emit single-line JSON to stdout."""
    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)

    handler = logging.StreamHandler(sys.stdout)
    formatter = TraceInjectingFormatter(
        fmt="%(message)s %(levelname)s %(name)s",
        datefmt="%Y-%m-%dT%H:%M:%S.%fZ",
    )
    handler.setFormatter(formatter)
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # gunicorn/werkzeug talk to a distinct logger tree; align them.
    for noisy in ("gunicorn.access", "gunicorn.error", "werkzeug"):
        logging.getLogger(noisy).handlers = [handler]
        logging.getLogger(noisy).propagate = False

    if not include_stack:
        logging.getLogger("urllib3").setLevel(logging.WARNING)

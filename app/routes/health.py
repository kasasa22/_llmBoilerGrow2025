"""Liveness + readiness endpoints for Kubernetes probes."""
from __future__ import annotations

from flask import Blueprint, jsonify

from app.config import get_settings
from app.redis_bus import get_bus

bp = Blueprint("health", __name__)


@bp.get("/healthz")
def healthz():
    return jsonify({"ok": True}), 200


@bp.get("/readyz")
def readyz():
    checks: dict[str, bool] = {}
    cfg = get_settings()

    checks["redis"] = get_bus().ping()

    # Ollama is optional at boot (it may still be pulling models); return 200
    # even if unreachable, but surface the state in the body so the reviewer
    # can diagnose.
    checks["ollama_configured"] = bool(cfg.ollama_base_url)

    status = 200 if all(checks.values()) else 503
    return jsonify({"ok": status == 200, "checks": checks}), status

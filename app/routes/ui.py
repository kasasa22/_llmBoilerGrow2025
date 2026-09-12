"""Serves the single-page chat UI."""
from __future__ import annotations

from flask import Blueprint, render_template

from app.config import get_settings

bp = Blueprint("ui", __name__)


@bp.get("/")
def index():
    cfg = get_settings()
    return render_template(
        "index.html",
        model_name=cfg.model_name,
        env=cfg.env,
    )

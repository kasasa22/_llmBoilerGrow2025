"""Flask app factory. Wires blueprints, error handlers, logging."""
from __future__ import annotations

import logging
from typing import Any

from flask import Flask, jsonify

from app.config import get_settings
from app.logging_config import setup_logging
from app.routes.chat import bp as chat_bp
from app.routes.health import bp as health_bp
from app.routes.stream import bp as stream_bp
from app.routes.ui import bp as ui_bp


def create_app() -> Flask:
    cfg = get_settings()
    setup_logging(level=cfg.log_level, include_stack=cfg.log_include_stack)

    app = Flask(
        __name__.split(".")[0],  # "app"
        template_folder="templates",
        static_folder="static",
        static_url_path="/static",
    )
    app.config["JSON_SORT_KEYS"] = False
    app.config["JSONIFY_PRETTYPRINT_REGULAR"] = False

    app.register_blueprint(health_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(stream_bp)
    app.register_blueprint(ui_bp)

    _install_error_handlers(app)

    logging.getLogger(__name__).info(
        "app.started",
        extra={"env": cfg.env, "model": cfg.model_name, "ollama": cfg.ollama_base_url},
    )
    return app


def _install_error_handlers(app: Flask) -> None:
    """Uniform JSON error envelope. Never leak stack traces."""

    @app.errorhandler(400)
    def bad_request(err: Any):
        return _json_error(400, "bad_request", str(err.description) if hasattr(err, "description") else "bad request")

    @app.errorhandler(404)
    def not_found(_err: Any):
        return _json_error(404, "not_found", "not found")

    @app.errorhandler(409)
    def conflict(err: Any):
        return _json_error(409, "conflict", str(err.description) if hasattr(err, "description") else "conflict")

    @app.errorhandler(500)
    def server_error(_err: Any):
        logging.getLogger(__name__).exception("unhandled.exception")
        return _json_error(500, "internal_error", "internal error")


def _json_error(status: int, code: str, message: str):
    return jsonify({"error": code, "message": message}), status

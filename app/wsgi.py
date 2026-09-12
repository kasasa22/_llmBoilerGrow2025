"""Gunicorn WSGI entrypoint.

Run:
    gunicorn --chdir /srv --worker-class gevent -w 2 app.wsgi:app
"""
from __future__ import annotations

# gevent monkey-patching MUST happen before any stdlib socket/select import;
# gunicorn's gevent worker already patches, but importing this file directly
# (e.g. local dev via `python -m app.wsgi`) also needs it, and double-patching
# is a no-op.
from gevent import monkey

monkey.patch_all()

from app.routes import create_app  # noqa: E402  (import after monkey-patch)

app = create_app()


if __name__ == "__main__":
    # Local dev fallback. Prefer `gunicorn app.wsgi:app` in real use.
    app.run(host="0.0.0.0", port=8080, debug=False)

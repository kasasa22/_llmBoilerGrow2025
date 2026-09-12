"""Thin backward-compat entrypoint.

Prefer running via gunicorn: ``gunicorn --chdir /srv app.wsgi:app`` (Docker)
or ``gunicorn app.wsgi:app`` (local dev from the repo root).

Kept so ``python main.py`` still works for quick smoke tests during development.
"""
from __future__ import annotations

import os
import sys


def main() -> None:
    # Ensure the parent of this file is on sys.path so `app.wsgi` resolves
    # regardless of where the script is invoked from.
    here = os.path.dirname(os.path.abspath(__file__))
    parent = os.path.dirname(here)
    if parent not in sys.path:
        sys.path.insert(0, parent)

    from app.wsgi import app

    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), debug=False)


if __name__ == "__main__":
    main()

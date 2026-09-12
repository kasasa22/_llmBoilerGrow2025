"""BOSMART Flask app package.

Public entrypoint is ``app.wsgi:app`` for gunicorn. The container Dockerfile
copies this folder to ``/srv/app`` and runs gunicorn with ``--chdir /srv``.
"""

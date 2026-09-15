from __future__ import annotations

import fakeredis
import pytest

import app.redis_bus as redis_bus
import app.routes.chat as chat_route
from app.routes import create_app


class _SharedFakeRedis(fakeredis.FakeRedis):
    server = fakeredis.FakeServer()

    @classmethod
    def from_url(cls, url, **kwargs):
        kwargs.pop("socket_keepalive", None)
        return cls(server=cls.server, **kwargs)


@pytest.fixture()
def fake_redis(monkeypatch):
    _SharedFakeRedis.server = fakeredis.FakeServer()
    monkeypatch.setattr(redis_bus.redis, "Redis", _SharedFakeRedis)
    monkeypatch.setattr(redis_bus, "_singleton", None)
    yield _SharedFakeRedis(server=_SharedFakeRedis.server, decode_responses=True)
    monkeypatch.setattr(redis_bus, "_singleton", None)


@pytest.fixture()
def dispatch(monkeypatch):
    calls: list[dict] = []

    def fake_send(**kwargs):
        calls.append(kwargs)
        if fake_send.fail:
            raise RuntimeError("inngest unreachable")

    fake_send.fail = False
    monkeypatch.setattr(chat_route, "send_research_query", fake_send)
    return fake_send, calls


@pytest.fixture()
def client(fake_redis, dispatch):
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()

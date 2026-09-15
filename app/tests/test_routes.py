from __future__ import annotations

import json

from app.redis_bus import job_final_key, job_hash_body_key, job_hash_key, job_log_key, job_status_key


def _post(client, body, **headers):
    return client.post("/api/chat", data=json.dumps(body), content_type="application/json", headers=headers)


def _envelope(seq, phase, job_id="job_x", data=None):
    return json.dumps({"seq": seq, "phase": phase, "trace_id": "t", "job_id": job_id, "ts": "2026-01-01T00:00:00Z", "data": data or {}})


def test_fresh_submission_returns_202_and_dispatches(client, dispatch, fake_redis):
    _, calls = dispatch
    resp = _post(client, {"query": "What is Ollama?"})
    assert resp.status_code == 202
    body = resp.get_json()
    assert body["idempotent"] is False
    assert body["stream_url"] == f"/api/jobs/{body['job_id']}/stream"
    assert resp.headers["Idempotency-Status"] == "created"
    assert len(resp.headers["x-trace-id"]) == 32
    assert calls and calls[0]["job_id"] == body["job_id"] and calls[0]["query"] == "What is Ollama?"
    assert fake_redis.hget(job_status_key(body["job_id"]), "state") == "queued"


def test_duplicate_query_replays_same_job(client, dispatch):
    _, calls = dispatch
    first = _post(client, {"query": "What is Ollama?"}).get_json()
    resp = _post(client, {"query": "  what is   ollama?  "})
    assert resp.status_code == 200
    assert resp.get_json() == {**first, "idempotent": True}
    assert resp.headers["Idempotency-Status"] == "replayed"
    assert len(calls) == 1


def test_idempotency_key_reuse_with_different_body_is_409(client):
    assert _post(client, {"query": "alpha question"}, **{"Idempotency-Key": "client-key-0001"}).status_code == 202
    resp = _post(client, {"query": "alpha question", "extra": 1}, **{"Idempotency-Key": "client-key-0001"})
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "idempotency_key_reuse"
    assert resp.headers["Idempotency-Status"] == "conflict"


def test_same_query_different_keys_are_separate_jobs(client, dispatch):
    _, calls = dispatch
    a = _post(client, {"query": "same question"}, **{"Idempotency-Key": "tab-one-00001"}).get_json()
    b = _post(client, {"query": "same question"}, **{"Idempotency-Key": "tab-two-00001"}).get_json()
    assert a["job_id"] != b["job_id"]
    assert len(calls) == 2


def test_bad_bodies_are_400(client):
    assert client.post("/api/chat", data="not json", content_type="application/json").status_code == 400
    assert _post(client, {}).status_code == 400
    assert _post(client, {"query": "   "}).status_code == 400
    assert _post(client, {"query": "x" * 5000}).status_code == 400
    resp = _post(client, {"query": "ok"}, **{"Idempotency-Key": "short"})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_idempotency_key"


def test_unknown_fields_are_ignored(client, dispatch):
    _, calls = dispatch
    resp = _post(client, {"query": "ok question", "model": "llama3", "max_steps": 3})
    assert resp.status_code == 202
    assert "model" not in calls[0] and "max_steps" not in calls[0]


def test_dispatch_failure_releases_the_idempotency_claim(client, dispatch, fake_redis):
    fake_send, calls = dispatch
    fake_send.fail = True
    resp = _post(client, {"query": "flaky question"})
    assert resp.status_code == 502
    assert resp.get_json()["error"] == "dispatch_failed"
    assert fake_redis.keys(job_hash_key("*")) == []
    assert fake_redis.keys(job_hash_body_key("*")) == []

    fake_send.fail = False
    retry = _post(client, {"query": "flaky question"})
    assert retry.status_code == 202
    assert retry.get_json()["idempotent"] is False
    assert len(calls) == 2


def test_orphaned_claim_without_job_is_reclaimed(client, dispatch, fake_redis):
    from app.idempotency import compute_request_hash

    fake_redis.set(job_hash_body_key(compute_request_hash("orphan question", None)), "deadbeef")
    resp = _post(client, {"query": "orphan question"})
    assert resp.status_code == 202
    assert resp.get_json()["idempotent"] is False


def test_get_job_status(client):
    job_id = _post(client, {"query": "status question"}).get_json()["job_id"]
    assert client.get(f"/api/jobs/{job_id}").get_json()["state"] == "queued"
    assert client.get("/api/jobs/job_nope").status_code == 404


def test_stream_replays_log_then_final_and_closes(client, fake_redis):
    job_id = "job_replay"
    for seq, phase in [(1, "job.started"), (2, "tool.called")]:
        fake_redis.lpush(job_log_key(job_id), _envelope(seq, phase, job_id))
    fake_redis.set(job_final_key(job_id), _envelope(3, "final", job_id, {"answer": "hi", "citations": []}))
    resp = client.get(f"/api/jobs/{job_id}/stream")
    text = resp.get_data(as_text=True)
    assert resp.mimetype == "text/event-stream"
    events = [line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("event:")]
    assert events == ["job.started", "tool.called", "final", "done"]


def test_stream_does_not_duplicate_done_when_log_already_has_it(client, fake_redis):
    job_id = "job_done"
    fake_redis.lpush(job_log_key(job_id), _envelope(1, "job.started", job_id))
    fake_redis.lpush(job_log_key(job_id), _envelope(2, "final", job_id))
    fake_redis.lpush(job_log_key(job_id), _envelope(3, "done", job_id, {"state": "done"}))
    fake_redis.set(job_final_key(job_id), _envelope(2, "final", job_id))
    text = client.get(f"/api/jobs/{job_id}/stream").get_data(as_text=True)
    events = [line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("event:")]
    assert events == ["job.started", "final", "done"]


def test_stream_honours_last_event_id(client, fake_redis):
    job_id = "job_resume"
    for seq, phase in [(1, "job.started"), (2, "tool.called"), (3, "final"), (4, "done")]:
        fake_redis.lpush(job_log_key(job_id), _envelope(seq, phase, job_id))
    fake_redis.set(job_final_key(job_id), _envelope(3, "final", job_id))
    text = client.get(f"/api/jobs/{job_id}/stream", headers={"Last-Event-ID": "2"}).get_data(as_text=True)
    events = [line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("event:")]
    assert events == ["final", "done"]


def test_healthz_and_readyz(client):
    assert client.get("/healthz").get_json() == {"ok": True}
    ready = client.get("/readyz")
    assert ready.status_code == 200
    assert ready.get_json()["checks"]["redis"] is True

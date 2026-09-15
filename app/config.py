"""Environment-driven settings for the Flask app.

Env-first: every value is overridable via the environment. The legacy
container-detection heuristic from the original main.py is preserved as a
last-resort fallback for OLLAMA_BASE_URL only, so unset-env local runs still
work against a port-forwarded Ollama.
"""
from __future__ import annotations

from functools import lru_cache
from os import path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _running_in_container() -> bool:
    if path.exists("/var/run/secrets/kubernetes.io/serviceaccount/namespace"):
        return True
    if path.exists("/.dockerenv"):
        return True
    if path.isfile("/proc/self/cgroup"):
        try:
            with open("/proc/self/cgroup", encoding="utf-8") as fh:
                for line in fh:
                    if "kubepods" in line or "docker" in line:
                        return True
        except OSError:
            return False
    return False


def _default_ollama_base_url() -> str:
    return (
        "http://ollama.ollama.svc.cluster.local:11434"
        if _running_in_container()
        else "http://localhost:11434"
    )


class Settings(BaseSettings):
    """Runtime configuration. Reads env vars; ignores unknown keys."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    env: Literal["dev", "prod"] = "dev"
    log_level: str = "info"
    log_include_stack: bool = False

    ollama_base_url: str = Field(default_factory=_default_ollama_base_url)
    model_name: str = "qwen2.5:7b"

    redis_url: str = "redis://localhost:6379/0"

    inngest_app_id: str = "bosmart-flask"
    inngest_base_url: str = "http://localhost:8288"
    inngest_event_key: str = ""
    inngest_signing_key: str = ""

    idempotency_ttl_seconds: int = 3600
    job_status_ttl_seconds: int = 86400
    request_max_query_chars: int = 2000

    trace_id_header: str = "x-trace-id"

    sse_keepalive_seconds: int = 15
    sse_replay_max: int = 500


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

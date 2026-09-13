"""Ingress idempotency for POST /api/chat.

Katlego probed this area explicitly. The hash logic is the load-bearing
piece — if the normalisation collapses too aggressively, unrelated
requests dedup; if it collapses too little, retries produce duplicate jobs.
"""
from __future__ import annotations

import pytest

from app.idempotency import (
    IDEMPOTENCY_KEY_RE,
    compute_body_hash,
    compute_request_hash,
    is_valid_idempotency_key,
    normalize_query,
)


class TestNormalizeQuery:
    def test_strips_leading_trailing_whitespace(self):
        assert normalize_query("  hello  ") == "hello"

    def test_lowercases_input(self):
        assert normalize_query("HELLO WORLD") == "hello world"

    def test_collapses_internal_whitespace(self):
        assert normalize_query("hello    world") == "hello world"
        assert normalize_query("hello\tworld") == "hello world"
        assert normalize_query("hello\nworld") == "hello world"

    def test_empty_string(self):
        assert normalize_query("") == ""


class TestComputeRequestHash:
    def test_same_normalized_query_produces_same_hash(self):
        # Two requests with cosmetic differences must dedup.
        h1 = compute_request_hash("What is Civo?", None)
        h2 = compute_request_hash("what is civo?", None)
        h3 = compute_request_hash("   What   is   Civo?   ", None)
        assert h1 == h2 == h3

    def test_different_queries_produce_different_hashes(self):
        assert compute_request_hash("query A", None) != compute_request_hash("query B", None)

    def test_idempotency_key_salts_the_hash(self):
        # Same query, different keys -> different hashes (different logical requests).
        h_without = compute_request_hash("hello", None)
        h_with_k1 = compute_request_hash("hello", "key-alpha-01")
        h_with_k2 = compute_request_hash("hello", "key-beta-02")
        assert h_without != h_with_k1
        assert h_with_k1 != h_with_k2

    def test_hash_is_64_hex_chars_sha256(self):
        h = compute_request_hash("hello", None)
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_empty_key_treated_as_missing_key(self):
        # `""` is falsy, so it must NOT salt the hash.
        assert compute_request_hash("hello", "") == compute_request_hash("hello", None)


class TestComputeBodyHash:
    def test_byte_identical_bodies_hash_the_same(self):
        assert compute_body_hash(b'{"query":"hi"}') == compute_body_hash(b'{"query":"hi"}')

    def test_whitespace_matters(self):
        # Body hash is byte-exact (unlike request hash which normalizes).
        # A whitespace-only diff on the same JSON must produce a DIFFERENT body hash
        # so 409 conflict fires for Idempotency-Key reuse with a whitespace-changed body.
        assert compute_body_hash(b'{"query":"hi"}') != compute_body_hash(b'{"query":"hi" }')


class TestIsValidIdempotencyKey:
    @pytest.mark.parametrize(
        "key",
        [
            "abcdefgh",  # min length 8
            "a" * 128,  # max length 128
            "hyphen-dash_and.dot~tilde",
            "ALL-CAPS-IS-FINE",
            "123456789012",
        ],
    )
    def test_accepts_valid_keys(self, key: str):
        assert is_valid_idempotency_key(key) is True

    @pytest.mark.parametrize(
        "key",
        [
            None,
            "",
            "short",  # < 8
            "a" * 129,  # > 128
            "spaces are not allowed",
            "unicode-é-not-in-charset",
            "brace{}not-allowed",
            "at@sign-not-allowed",
            "path/slash",
        ],
    )
    def test_rejects_invalid_keys(self, key):
        assert is_valid_idempotency_key(key) is False

    def test_regex_boundaries(self):
        # Enforce the documented pattern exactly.
        assert IDEMPOTENCY_KEY_RE.pattern == r"^[A-Za-z0-9._~-]{8,128}$"

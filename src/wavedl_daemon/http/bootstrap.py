"""Ephemeral bootstrap exchanges and credential-safe access logging.

This module never persists credentials, sets cookies, or binds a listener.
Bootstrap codes are 256-bit random capabilities, held only as digests until
their first exchange or expiration. Access-log filtering is explicit opt-in.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import math
import re
import secrets
import threading
import time
from typing import TYPE_CHECKING
from urllib.parse import unquote_plus

from wavedl_daemon.http.auth import credential_bytes


if TYPE_CHECKING:
    from collections.abc import Callable


_REDACTED = "[REDACTED]"
_CODE = re.compile(r"[A-Za-z0-9_-]{43}\Z")
_CODE_RUN = re.compile(r"[A-Za-z0-9_-]{43,}\Z")
_SENSITIVE_NAMES = frozenset(
    {"token", "access_token", "bootstrap", "bootstrap_code", "code", "authorization"}
)
_QUERY_FIELD = re.compile(r"([?&;])([^\s?&;=\"'<>]+)=([^\s&;#\"'<>]*)")
_AUTH_HEADER = re.compile(r"(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,\"'<>&;#]+")
_CODE_CANDIDATE = re.compile(r"(?:[A-Za-z0-9_-]|%[0-9a-fA-F]{2}){43,}")


class BootstrapExchangeError(ValueError):
    """An invalid, expired, or already consumed bootstrap capability."""


class BootstrapCapacityError(RuntimeError):
    """The bounded pool is full; minting fails closed."""


class BootstrapCredentials:
    """Thread-safe, bounded single-use exchange for an explicit bearer token."""

    def __init__(
        self,
        access_token: str,
        *,
        ttl_seconds: float = 120,
        max_pending: int = 128,
        clock: Callable[[], float] = time.monotonic,
    ):
        credential_bytes(access_token)
        if (
            isinstance(ttl_seconds, bool)
            or not isinstance(ttl_seconds, (int, float))
            or not math.isfinite(ttl_seconds)
            or ttl_seconds <= 0
        ):
            raise ValueError("Invalid bootstrap lifetime")
        if (
            isinstance(max_pending, bool)
            or not isinstance(max_pending, int)
            or max_pending < 1
        ):
            raise ValueError("Invalid bootstrap capacity")
        if not callable(clock):
            raise ValueError("Invalid bootstrap clock")
        self._access_token = access_token
        self._ttl_seconds = ttl_seconds
        self._max_pending = max_pending
        self._clock = clock
        self._lock = threading.Lock()
        self._pending: dict[bytes, float] = {}

    def _expire(self, now: float) -> None:
        self._pending = {
            digest: deadline
            for digest, deadline in self._pending.items()
            if deadline > now
        }

    def mint(self) -> str:
        """Return a fresh short-lived code; never retain its plaintext."""
        with self._lock:
            now = self._clock()
            if not math.isfinite(now):
                raise BootstrapCapacityError("Bootstrap unavailable")
            self._expire(now)
            if len(self._pending) >= self._max_pending:
                raise BootstrapCapacityError("Bootstrap capacity reached")
            # No retry loop: even a hypothetical random collision fails closed.
            code = secrets.token_urlsafe(32)
            digest = hashlib.sha256(code.encode("ascii")).digest()
            if digest in self._pending:
                raise BootstrapCapacityError("Bootstrap unavailable")
            deadline = now + self._ttl_seconds
            if not math.isfinite(deadline):
                raise BootstrapCapacityError("Bootstrap unavailable")
            self._pending[digest] = deadline
            return code

    def exchange(self, code: object) -> str:
        """Atomically consume one valid code or raise a secret-free error."""
        if not isinstance(code, str) or not _CODE.fullmatch(code):
            raise BootstrapExchangeError("Invalid or expired bootstrap code")
        candidate = hashlib.sha256(code.encode("ascii")).digest()
        with self._lock:
            now = self._clock()
            if not math.isfinite(now):
                raise BootstrapExchangeError("Invalid or expired bootstrap code")
            self._expire(now)
            matched = None
            for digest in self._pending:
                if hmac.compare_digest(candidate, digest):
                    matched = digest
            if matched is None:
                raise BootstrapExchangeError("Invalid or expired bootstrap code")
            del self._pending[matched]
            return self._access_token

    def matches_token(self, token: str) -> bool:
        """Allow app assembly to reject a mismatched injected credential pool."""
        return hmac.compare_digest(
            credential_bytes(token), credential_bytes(self._access_token)
        )


def _decode(value: str) -> str:
    # Bounded repeated decoding also covers nested URL encoding without parsing
    # an attacker-controlled URL (which may contain malformed IPv6 authorities).
    for _ in range(3):
        decoded = unquote_plus(value, errors="replace")
        if decoded == value:
            break
        value = decoded
    return value


class AccessLogRedactionFilter(logging.Filter):
    """Redact rendered messages, including uvicorn's five-argument format.

    All bootstrap-shaped strings are redacted, including expired/consumed
    codes. This avoids retaining a second plaintext or unbounded replay list.
    Non-sensitive query fields retain their original encoding and spelling.
    """

    def __init__(self, credentials: BootstrapCredentials | str):
        super().__init__()
        token = (
            credentials._access_token
            if isinstance(credentials, BootstrapCredentials)
            else credentials
        )
        credential_bytes(token)
        # Match either literal or percent-encoded characters without decoding
        # the whole message and altering non-sensitive pagination fields.
        pattern = "".join(
            f"(?:{re.escape(char)}|%{ord(char):02x}|%25{ord(char):02x}|%2525{ord(char):02x})"
            for char in token
        )
        self._token_pattern = re.compile(pattern, re.IGNORECASE)

    def redact(self, message: str) -> str:
        def query_field(match):
            separator, key, value = match.groups()
            if _decode(key).lower() in _SENSITIVE_NAMES:
                value = _REDACTED
            return f"{separator}{key}={value}"

        message = _QUERY_FIELD.sub(query_field, message)
        message = _AUTH_HEADER.sub(lambda match: match[1] + _REDACTED, message)
        message = self._token_pattern.sub(_REDACTED, message)
        return _CODE_CANDIDATE.sub(
            lambda match: (
                _REDACTED if _CODE_RUN.fullmatch(_decode(match[0])) else match[0]
            ),
            message,
        )

    def filter(self, record: logging.LogRecord) -> bool:
        # Uvicorn's AccessFormatter unpacks these arguments itself. Preserve
        # its contract rather than only sanitizing the rendered message.
        if (
            record.msg == '%s - "%s %s HTTP/%s" %d'
            and isinstance(record.args, tuple)
            and len(record.args) == 5
        ):
            record.args = tuple(
                self.redact(value) if isinstance(value, str) else value
                for value in record.args
            )
            record.exc_info, record.exc_text, record.stack_info = None, None, None
            return True
        try:
            message = record.getMessage()
        except Exception:
            # Formatting failures must not fall back to repr(raw secret args).
            message = "[unformattable access log]"
        record.msg, record.args = self.redact(message), ()
        # Access logs should not carry exception tracebacks containing secrets.
        record.exc_info, record.exc_text, record.stack_info = None, None, None
        return True


def install_access_log_redaction(
    credentials: BootstrapCredentials | str, logger: logging.Logger | None = None
) -> AccessLogRedactionFilter:
    """Explicitly protect a logger; importing/constructing the app is inert."""
    redactor = AccessLogRedactionFilter(credentials)
    (logger if logger is not None else logging.getLogger("uvicorn.access")).addFilter(
        redactor
    )
    return redactor

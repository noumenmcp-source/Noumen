from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Literal, NotRequired, Protocol, TypedDict

DEFAULT_ENDPOINT = "http://localhost:8110"
MAX_BATCH_SIZE = 500

JsonObject = dict[str, object]


class TrackEvent(TypedDict):
    type: Literal["track"]
    anonymousId: str
    event: str
    properties: NotRequired[JsonObject]


class IdentifyEvent(TypedDict):
    type: Literal["identify"]
    anonymousId: str
    userId: NotRequired[str]
    traits: NotRequired[JsonObject]


Event = TrackEvent | IdentifyEvent


@dataclass(frozen=True)
class TransportResponse:
    status_code: int


class Transport(Protocol):
    def __call__(self, url: str, payload: JsonObject) -> TransportResponse:
        """Send one CDP batch and return a status response."""


class CdpError(RuntimeError):
    """Raised when CDP ingestion rejects or exhausts a batch."""


class CdpClient:
    """Server-side CDP client.

    Example:
        >>> cdp = CdpClient("wk_...")
        >>> cdp.track("anon_123", "Order Created", {"value": 49})
        >>> cdp.close()
    """

    def __init__(
        self,
        write_key: str,
        endpoint: str = DEFAULT_ENDPOINT,
        flush_at: int = 20,
        transport: Transport | None = None,
        max_retries: int = 2,
        retry_delay_seconds: float = 0.1,
    ) -> None:
        self.write_key = write_key
        self.endpoint = track_url(endpoint)
        self.flush_at = clamp(flush_at, 1, MAX_BATCH_SIZE)
        self.transport = transport or UrllibTransport()
        self.max_retries = max_retries
        self.retry_delay_seconds = retry_delay_seconds
        self._buffer: list[Event] = []

    def track(self, anonymous_id: str, event: str, properties: JsonObject | None = None) -> None:
        item: TrackEvent = {"type": "track", "anonymousId": anonymous_id, "event": event}
        if properties is not None:
            item["properties"] = properties
        self._enqueue(item)

    def identify(
        self,
        anonymous_id: str,
        traits: JsonObject | None = None,
        user_id: str | None = None,
    ) -> None:
        item: IdentifyEvent = {"type": "identify", "anonymousId": anonymous_id}
        if user_id is not None:
            item["userId"] = user_id
        if traits is not None:
            item["traits"] = traits
        self._enqueue(item)

    def flush(self) -> None:
        while self._buffer:
            events = self._take_batch()
            try:
                self._post_batch(events)
            except Exception:
                self._buffer = events + self._buffer
                raise

    def close(self) -> None:
        self.flush()

    def __enter__(self) -> CdpClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _enqueue(self, event: Event) -> None:
        self._buffer.append(event)
        if len(self._buffer) >= self.flush_at:
            self.flush()

    def _take_batch(self) -> list[Event]:
        events = self._buffer[:MAX_BATCH_SIZE]
        del self._buffer[:MAX_BATCH_SIZE]
        return events

    def _post_batch(self, events: list[Event]) -> None:
        payload = {"writeKey": self.write_key, "events": events}
        for attempt in range(self.max_retries + 1):
            if self._try_post(payload, attempt):
                return

    def _try_post(self, payload: JsonObject, attempt: int) -> bool:
        try:
            response = self.transport(self.endpoint, payload)
            if response.status_code >= 500:
                raise CdpError(f"CDP retryable {response.status_code}")
            if response.status_code >= 400:
                raise NonRetryableError(f"CDP rejected {response.status_code}")
            return True
        except NonRetryableError:
            raise
        except Exception as error:
            if attempt >= self.max_retries:
                raise CdpError("CDP batch failed") from error
            sleep(self.retry_delay_seconds * (2**attempt))
            return False


class NonRetryableError(CdpError):
    pass


class UrllibTransport:
    def __call__(self, url: str, payload: JsonObject) -> TransportResponse:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return TransportResponse(status_code=response.status)
        except urllib.error.HTTPError as error:
            return TransportResponse(status_code=error.code)


def track_url(endpoint: str) -> str:
    trimmed = endpoint.rstrip("/")
    return trimmed if trimmed.endswith("/v1/track") else f"{trimmed}/v1/track"


def clamp(value: int, minimum: int, maximum: int) -> int:
    return min(max(value, minimum), maximum)


def sleep(seconds: float) -> None:
    if seconds > 0:
        time.sleep(seconds)

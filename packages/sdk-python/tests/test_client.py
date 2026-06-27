import pytest

from cdp_us import CdpClient, CdpError, TransportResponse


class MockTransport:
    def __init__(self, statuses: list[int]) -> None:
        self.statuses = statuses
        self.calls: list[tuple[str, dict[str, object]]] = []

    def __call__(self, url: str, payload: dict[str, object]) -> TransportResponse:
        self.calls.append((url, payload))
        status = self.statuses.pop(0) if self.statuses else 202
        return TransportResponse(status_code=status)


def test_posts_track_payload_to_track_endpoint() -> None:
    transport = MockTransport([202])
    cdp = CdpClient("wk_us", endpoint="https://api.test", transport=transport)

    cdp.track("anon_1", "Signed Up", {"plan": "pro"})
    cdp.flush()

    url, payload = transport.calls[-1]
    assert url == "https://api.test/v1/track"
    assert payload["writeKey"] == "wk_us"
    assert payload["events"] == [
        {"type": "track", "anonymousId": "anon_1", "event": "Signed Up", "properties": {"plan": "pro"}}
    ]


def test_flushes_when_buffer_reaches_flush_at() -> None:
    transport = MockTransport([202])
    cdp = CdpClient("wk_us", flush_at=2, transport=transport)

    cdp.track("a1", "One")
    cdp.identify("a1", {"email": "person@example.com"}, "u1")

    assert len(transport.calls[-1][1]["events"]) == 2


def test_retries_5xx_then_succeeds() -> None:
    transport = MockTransport([500, 202])
    cdp = CdpClient("wk_us", flush_at=1, transport=transport, retry_delay_seconds=0)

    cdp.track("anon", "Retry")

    assert len(transport.calls) == 2


def test_does_not_retry_4xx() -> None:
    transport = MockTransport([400])
    cdp = CdpClient("wk_us", flush_at=1, transport=transport)

    with pytest.raises(CdpError, match="CDP rejected 400"):
        cdp.track("anon", "Bad")
    assert len(transport.calls) == 1


def test_close_flushes_buffered_events() -> None:
    transport = MockTransport([202])
    cdp = CdpClient("wk_us", flush_at=20, transport=transport)

    cdp.track("anon", "Buffered")
    cdp.close()

    assert len(transport.calls[-1][1]["events"]) == 1

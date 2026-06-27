package cdp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestTrackPayload(t *testing.T) {
	transport := newMockTransport(response{status: http.StatusAccepted})
	client := New(
		"wk_us",
		WithEndpoint("https://api.test"),
		WithHTTPClient(&http.Client{Transport: transport}),
	)

	if err := client.Track("anon_1", "Signed Up", map[string]any{"plan": "pro"}); err != nil {
		t.Fatalf("Track returned error: %v", err)
	}
	if err := client.Flush(); err != nil {
		t.Fatalf("Flush returned error: %v", err)
	}

	if got, want := transport.calls[0].url, "https://api.test/v1/track"; got != want {
		t.Fatalf("url = %q, want %q", got, want)
	}
	if got, want := transport.calls[0].method, http.MethodPost; got != want {
		t.Fatalf("method = %q, want %q", got, want)
	}
	if got, want := transport.calls[0].header.Get("content-type"), "application/json"; got != want {
		t.Fatalf("content-type = %q, want %q", got, want)
	}

	payload := decodePayload(t, transport.calls[0].body)
	if payload.WriteKey != "wk_us" {
		t.Fatalf("writeKey = %q, want wk_us", payload.WriteKey)
	}
	if len(payload.Events) != 1 {
		t.Fatalf("events length = %d, want 1", len(payload.Events))
	}
	event := payload.Events[0]
	if event.Type != "track" || event.AnonymousID != "anon_1" || event.Event != "Signed Up" {
		t.Fatalf("unexpected event: %+v", event)
	}
	if event.Properties["plan"] != "pro" {
		t.Fatalf("properties = %+v, want plan=pro", event.Properties)
	}
	assertPayloadShape(t, transport.calls[0].body)
}

func TestBatchingCapsRequestsAt500Events(t *testing.T) {
	transport := newMockTransport(response{status: http.StatusAccepted}, response{status: http.StatusAccepted})
	client := New(
		"wk_us",
		WithFlushAt(500),
		WithHTTPClient(&http.Client{Transport: transport}),
	)

	for i := 0; i < 501; i++ {
		if err := client.Track("anon", "Batch", nil); err != nil {
			t.Fatalf("Track(%d) returned error: %v", i, err)
		}
	}
	if err := client.Flush(); err != nil {
		t.Fatalf("Flush returned error: %v", err)
	}

	if got, want := len(transport.calls), 2; got != want {
		t.Fatalf("calls = %d, want %d", got, want)
	}
	if got, want := len(decodePayload(t, transport.calls[0].body).Events), 500; got != want {
		t.Fatalf("first batch events = %d, want %d", got, want)
	}
	if got, want := len(decodePayload(t, transport.calls[1].body).Events), 1; got != want {
		t.Fatalf("second batch events = %d, want %d", got, want)
	}
}

func TestRetries5xxResponses(t *testing.T) {
	transport := newMockTransport(
		response{status: http.StatusInternalServerError},
		response{status: http.StatusBadGateway},
		response{status: http.StatusAccepted},
	)
	client := New("wk_us", WithHTTPClient(&http.Client{Transport: transport}), WithMaxRetries(2))

	if err := client.Track("anon", "Retry", nil); err != nil {
		t.Fatalf("Track returned error: %v", err)
	}
	if err := client.Flush(); err != nil {
		t.Fatalf("Flush returned error: %v", err)
	}

	if got, want := len(transport.calls), 3; got != want {
		t.Fatalf("calls = %d, want %d", got, want)
	}
}

func TestRetriesNetworkErrors(t *testing.T) {
	transport := newMockTransport(
		response{err: errors.New("temporary network failure")},
		response{status: http.StatusAccepted},
	)
	client := New("wk_us", WithHTTPClient(&http.Client{Transport: transport}), WithMaxRetries(1))

	if err := client.Track("anon", "Retry Network", nil); err != nil {
		t.Fatalf("Track returned error: %v", err)
	}
	if err := client.Flush(); err != nil {
		t.Fatalf("Flush returned error: %v", err)
	}

	if got, want := len(transport.calls), 2; got != want {
		t.Fatalf("calls = %d, want %d", got, want)
	}
}

func TestDoesNotRetry4xxResponses(t *testing.T) {
	transport := newMockTransport(response{status: http.StatusBadRequest})
	client := New("wk_us", WithHTTPClient(&http.Client{Transport: transport}), WithMaxRetries(3))

	if err := client.Track("anon", "Bad", nil); err != nil {
		t.Fatalf("Track returned error: %v", err)
	}
	if err := client.Flush(); err == nil || !strings.Contains(err.Error(), "rejected status 400") {
		t.Fatalf("Flush error = %v, want rejected status 400", err)
	}

	if got, want := len(transport.calls), 1; got != want {
		t.Fatalf("calls = %d, want %d", got, want)
	}
}

func TestFlushAndCloseSendBufferedEvents(t *testing.T) {
	transport := newMockTransport(response{status: http.StatusAccepted}, response{status: http.StatusAccepted})
	client := New("wk_us", WithFlushAt(20), WithHTTPClient(&http.Client{Transport: transport}))

	if err := client.Track("anon", "Buffered", nil); err != nil {
		t.Fatalf("Track returned error: %v", err)
	}
	if err := client.Flush(); err != nil {
		t.Fatalf("Flush returned error: %v", err)
	}

	if err := client.Identify("anon", map[string]any{"email": "person@example.com"}, "user_1"); err != nil {
		t.Fatalf("Identify returned error: %v", err)
	}
	if err := client.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	if got, want := len(transport.calls), 2; got != want {
		t.Fatalf("calls = %d, want %d", got, want)
	}
	closePayload := decodePayload(t, transport.calls[1].body)
	if got, want := len(closePayload.Events), 1; got != want {
		t.Fatalf("close events = %d, want %d", got, want)
	}
	event := closePayload.Events[0]
	if event.Type != "identify" || event.UserID != "user_1" || event.Traits["email"] != "person@example.com" {
		t.Fatalf("unexpected identify event: %+v", event)
	}
}

type mockTransport struct {
	responses []response
	calls     []requestRecord
}

type response struct {
	status int
	err    error
}

type requestRecord struct {
	method string
	url    string
	header http.Header
	body   []byte
}

func newMockTransport(responses ...response) *mockTransport {
	return &mockTransport{responses: responses}
}

func (transport *mockTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(request.Body)
	if err != nil {
		return nil, err
	}
	transport.calls = append(transport.calls, requestRecord{
		method: request.Method,
		url:    request.URL.String(),
		header: request.Header.Clone(),
		body:   body,
	})

	next := response{status: http.StatusAccepted}
	if len(transport.responses) > 0 {
		next = transport.responses[0]
		transport.responses = transport.responses[1:]
	}
	if next.err != nil {
		return nil, next.err
	}
	return &http.Response{
		StatusCode: next.status,
		Body:       io.NopCloser(strings.NewReader("")),
		Header:     make(http.Header),
	}, nil
}

func decodePayload(t *testing.T, body []byte) batchPayload {
	t.Helper()

	var payload batchPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}
	return payload
}

func assertPayloadShape(t *testing.T, body []byte) {
	t.Helper()

	var shape map[string]json.RawMessage
	if err := json.Unmarshal(body, &shape); err != nil {
		t.Fatalf("failed to decode payload shape: %v", err)
	}
	if len(shape) != 2 {
		t.Fatalf("payload keys = %v, want exactly writeKey and events", keys(shape))
	}
	if _, ok := shape["writeKey"]; !ok {
		t.Fatal("payload missing writeKey")
	}
	if _, ok := shape["events"]; !ok {
		t.Fatal("payload missing events")
	}
}

func keys(values map[string]json.RawMessage) []string {
	result := make([]string, 0, len(values))
	for key := range values {
		result = append(result, key)
	}
	return result
}

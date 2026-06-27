package cdp

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	defaultEndpoint = "http://localhost:8110"
	defaultFlushAt  = 20
	defaultRetries  = 2
	maxBatchSize    = 500
	retryBaseDelay  = 10 * time.Millisecond
)

var ErrClosed = errors.New("cdp: client is closed")

type Option func(*Client)

type Client struct {
	writeKey   string
	endpoint   string
	flushAt    int
	httpClient *http.Client
	maxRetries int

	mu      sync.Mutex
	flushMu sync.Mutex
	buffer  []Event
	closed  bool
}

type Event struct {
	Type        string         `json:"type"`
	AnonymousID string         `json:"anonymousId"`
	Event       string         `json:"event,omitempty"`
	Properties  map[string]any `json:"properties,omitempty"`
	UserID      string         `json:"userId,omitempty"`
	Traits      map[string]any `json:"traits,omitempty"`
}

type batchPayload struct {
	WriteKey string  `json:"writeKey"`
	Events   []Event `json:"events"`
}

func New(writeKey string, opts ...Option) *Client {
	client := &Client{
		writeKey:   writeKey,
		endpoint:   trackURL(defaultEndpoint),
		flushAt:    defaultFlushAt,
		httpClient: http.DefaultClient,
		maxRetries: defaultRetries,
	}

	for _, opt := range opts {
		opt(client)
	}

	client.flushAt = clamp(client.flushAt, 1, maxBatchSize)
	if client.httpClient == nil {
		client.httpClient = http.DefaultClient
	}
	client.endpoint = trackURL(client.endpoint)

	return client
}

func WithEndpoint(endpoint string) Option {
	return func(client *Client) {
		client.endpoint = endpoint
	}
}

func WithFlushAt(flushAt int) Option {
	return func(client *Client) {
		client.flushAt = flushAt
	}
}

func WithHTTPClient(httpClient *http.Client) Option {
	return func(client *Client) {
		client.httpClient = httpClient
	}
}

func WithMaxRetries(maxRetries int) Option {
	return func(client *Client) {
		if maxRetries < 0 {
			maxRetries = 0
		}
		client.maxRetries = maxRetries
	}
}

func (client *Client) Track(anonymousID, event string, props map[string]any) error {
	item := Event{
		Type:        "track",
		AnonymousID: anonymousID,
		Event:       event,
		Properties:  props,
	}
	return client.enqueue(item)
}

func (client *Client) Identify(anonymousID string, traits map[string]any, userID string) error {
	item := Event{
		Type:        "identify",
		AnonymousID: anonymousID,
		Traits:      traits,
		UserID:      userID,
	}
	return client.enqueue(item)
}

func (client *Client) Flush() error {
	client.flushMu.Lock()
	defer client.flushMu.Unlock()

	for {
		events := client.takeBatch()
		if len(events) == 0 {
			return nil
		}

		if err := client.postBatch(events); err != nil {
			client.restoreBatch(events)
			return err
		}
	}
}

func (client *Client) Close() error {
	client.mu.Lock()
	client.closed = true
	client.mu.Unlock()

	return client.Flush()
}

func (client *Client) enqueue(event Event) error {
	client.mu.Lock()
	if client.closed {
		client.mu.Unlock()
		return ErrClosed
	}
	client.buffer = append(client.buffer, event)
	shouldFlush := len(client.buffer) >= client.flushAt
	client.mu.Unlock()

	if shouldFlush {
		return client.Flush()
	}
	return nil
}

func (client *Client) takeBatch() []Event {
	client.mu.Lock()
	defer client.mu.Unlock()

	size := min(len(client.buffer), maxBatchSize)
	if size == 0 {
		return nil
	}

	events := make([]Event, size)
	copy(events, client.buffer[:size])
	client.buffer = client.buffer[size:]
	return events
}

func (client *Client) restoreBatch(events []Event) {
	client.mu.Lock()
	defer client.mu.Unlock()

	restored := make([]Event, 0, len(events)+len(client.buffer))
	restored = append(restored, events...)
	restored = append(restored, client.buffer...)
	client.buffer = restored
}

func (client *Client) postBatch(events []Event) error {
	body, err := json.Marshal(batchPayload{WriteKey: client.writeKey, Events: events})
	if err != nil {
		return fmt.Errorf("cdp: encode batch: %w", err)
	}

	for attempt := 0; attempt <= client.maxRetries; attempt++ {
		err := client.tryPost(body)
		if err == nil {
			return nil
		}
		if !isRetryable(err) || attempt == client.maxRetries {
			return err
		}
		time.Sleep(retryBaseDelay * time.Duration(1<<attempt))
	}

	return nil
}

func (client *Client) tryPost(body []byte) error {
	request, err := http.NewRequest(http.MethodPost, client.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("cdp: create request: %w", err)
	}
	request.Header.Set("content-type", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return retryableError{err: fmt.Errorf("cdp: post batch: %w", err)}
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)

	if response.StatusCode >= 500 {
		return retryableError{err: fmt.Errorf("cdp: retryable status %d", response.StatusCode)}
	}
	if response.StatusCode >= 400 {
		return fmt.Errorf("cdp: rejected status %d", response.StatusCode)
	}
	return nil
}

type retryableError struct {
	err error
}

func (err retryableError) Error() string {
	return err.err.Error()
}

func (err retryableError) Unwrap() error {
	return err.err
}

func isRetryable(err error) bool {
	var retryable retryableError
	return errors.As(err, &retryable)
}

func trackURL(endpoint string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if trimmed == "" {
		trimmed = defaultEndpoint
	}
	if strings.HasSuffix(trimmed, "/v1/track") {
		return trimmed
	}
	return trimmed + "/v1/track"
}

func clamp(value, minimum, maximum int) int {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

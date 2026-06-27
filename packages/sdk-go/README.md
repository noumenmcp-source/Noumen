# CDP Go SDK

Server-side ingestion SDK for CDP.

```go
package main

import cdp "github.com/noumenmcp-source/noumen/packages/sdk-go"

func main() {
	client := cdp.New("wk_us")
	defer client.Close()

	_ = client.Track("anon_123", "Order Created", map[string]any{
		"value": 49,
	})
	_ = client.Identify("anon_123", map[string]any{
		"email": "person@example.com",
	}, "user_123")

	_ = client.Flush()
}
```

## API

- `cdp.New(writeKey string, opts ...Option) *Client`
- `cdp.WithEndpoint(endpoint string)`
- `cdp.WithFlushAt(flushAt int)`
- `cdp.WithHTTPClient(httpClient *http.Client)`
- `cdp.WithMaxRetries(maxRetries int)`
- `(*Client).Track(anonymousID, event string, props map[string]any) error`
- `(*Client).Identify(anonymousID string, traits map[string]any, userID string) error`
- `(*Client).Flush() error`
- `(*Client).Close() error`

By default, the SDK posts JSON batches to `http://localhost:8110/v1/track` with this payload shape:

```json
{
  "writeKey": "wk_us",
  "events": []
}
```

Batches are capped at 500 events. Retry uses exponential backoff for network errors and `5xx` responses only. `4xx` responses are returned immediately and are not retried. `Close` flushes any buffered events.

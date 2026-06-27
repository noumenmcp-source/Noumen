# Ingest Gateway

This service receives analytics events from client websites/apps, validates them, stamps the tenant, and forwards to a Dittofeed instance's public API.

## Running the service

1. Create a `.env` file based on the `.env.example`.
2. Install dependencies: `npm install`.
3. Build the service: `npm run build`.
4. Start the service: `npm start`.

## Curl examples

Identify endpoint:
```bash
curl -X POST http://localhost:3000/v1/identify \
-H "Content-Type: application/json" \
-H "x-write-key: wk_abc" \
-d '{"userId": "123", "traits": {"name": "John"}}'
```

Track endpoint:
```bash
curl -X POST http://localhost:3000/v1/track \
-H "Content-Type: application/json" \
-H "x-write-key: wk_abc" \
-d '{"userId": "123", "event": "User Signed In"}'
```

Batch endpoint:
```bash
curl -X POST http://localhost:3000/v1/batch \
-H "Content-Type: application/json" \
-H "x-write-key: wk_abc" \
-d '{"batch":[{"type":"identify","userId":"123","traits":{"name":"John"}},{"type":"track","userId":"123","event":"User Signed In"}]}'
```

Health check:
```bash
curl http://localhost:3000/healthz
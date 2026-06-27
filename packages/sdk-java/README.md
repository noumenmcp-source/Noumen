# CDP-US Java SDK

Server-side ingestion client for Java 17+ services.

```java
CdpClient client = CdpClient.builder()
    .writeKey("wk_live")
    .endpoint("https://api.example.com")
    .flushAt(20)
    .build();

client.track("anon_123", "Order Completed", Map.of("value", 199));
client.identify("anon_123", Map.of("email", "buyer@example.com"), "user_123");
client.close();
```

Run tests:

```bash
mvn -q test
```

package com.cdpus.sdk;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;

public final class CdpClient implements AutoCloseable {
  private static final String DEFAULT_ENDPOINT = "http://localhost:8110";
  private static final int MAX_BATCH_SIZE = 500;

  private final String writeKey;
  private final String trackUrl;
  private final int flushAt;
  private final Transport transport;
  private final int maxRetries;
  private final int retryDelayMs;
  private final List<Map<String, Object>> buffer = new ArrayList<>();

  private CdpClient(Builder builder) {
    this.writeKey = builder.writeKey;
    this.trackUrl = trackUrl(builder.endpoint);
    this.flushAt = Math.max(1, Math.min(builder.flushAt, MAX_BATCH_SIZE));
    this.transport = builder.transport;
    this.maxRetries = builder.maxRetries;
    this.retryDelayMs = builder.retryDelayMs;
  }

  /** @return a new builder for CdpClient. */
  public static Builder builder() {
    return new Builder();
  }

  /** Queues a track event and flushes when the batch threshold is reached. */
  public void track(String anonymousId, String event, Map<String, Object> properties) {
    enqueue(EventPayload.track(anonymousId, event, properties).map());
  }

  /** Queues an identify event and flushes when the batch threshold is reached. */
  public void identify(String anonymousId, Map<String, Object> traits, String userId) {
    enqueue(EventPayload.identify(anonymousId, traits, userId).map());
  }

  /** Flushes all buffered events to /v1/track. */
  public void flush() {
    while (!buffer.isEmpty()) {
      List<Map<String, Object>> batch = drain();
      try {
        postBatch(batch);
      } catch (RuntimeException error) {
        buffer.addAll(0, batch);
        throw error;
      }
    }
  }

  @Override
  public void close() {
    flush();
  }

  private void enqueue(Map<String, Object> event) {
    buffer.add(event);
    if (buffer.size() >= flushAt) flush();
  }

  private List<Map<String, Object>> drain() {
    int size = Math.min(buffer.size(), MAX_BATCH_SIZE);
    List<Map<String, Object>> batch = new ArrayList<>(buffer.subList(0, size));
    buffer.subList(0, size).clear();
    return batch;
  }

  private void postBatch(List<Map<String, Object>> events) {
    String json = "{\"writeKey\":" + Json.write(writeKey) + ",\"events\":" + Json.write(events) + "}";
    for (int attempt = 0; attempt <= maxRetries; attempt++) {
      if (trySend(json, attempt)) return;
    }
  }

  private boolean trySend(String json, int attempt) {
    try {
      int status = transport.send(trackUrl, json);
      if (status >= 500) throw new IOException("retryable " + status);
      if (status >= 400) throw new CdpException("CDP rejected " + status);
      return true;
    } catch (IOException | InterruptedException error) {
      if (attempt >= maxRetries) throw new CdpException("CDP request failed", error);
      sleep(attempt);
      return false;
    }
  }

  private void sleep(int attempt) {
    if (retryDelayMs <= 0) return;
    try {
      Thread.sleep((long) retryDelayMs * (1L << attempt));
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new CdpException("Retry sleep interrupted", error);
    }
  }

  private static String trackUrl(String endpoint) {
    String trimmed = endpoint.replaceAll("/+$", "");
    return trimmed.endsWith("/v1/track") ? trimmed : trimmed + "/v1/track";
  }

  public static final class Builder {
    private String writeKey = "";
    private String endpoint = DEFAULT_ENDPOINT;
    private int flushAt = 20;
    private Transport transport = new HttpTransport();
    private int maxRetries = 2;
    private int retryDelayMs = 100;

    public Builder writeKey(String writeKey) { this.writeKey = writeKey; return this; }
    public Builder endpoint(String endpoint) { this.endpoint = endpoint; return this; }
    public Builder flushAt(int flushAt) { this.flushAt = flushAt; return this; }
    public Builder transport(Transport transport) { this.transport = transport; return this; }
    public Builder maxRetries(int maxRetries) { this.maxRetries = maxRetries; return this; }
    public Builder retryDelayMs(int retryDelayMs) { this.retryDelayMs = retryDelayMs; return this; }
    public CdpClient build() { return new CdpClient(this); }
  }

  private record EventPayload(Map<String, Object> map) {
    static EventPayload track(String anonymousId, String event, Map<String, Object> properties) {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("type", "track");
      payload.put("anonymousId", anonymousId);
      payload.put("event", event);
      if (properties != null) payload.put("properties", properties);
      return new EventPayload(payload);
    }

    static EventPayload identify(String anonymousId, Map<String, Object> traits, String userId) {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("type", "identify");
      payload.put("anonymousId", anonymousId);
      if (userId != null) payload.put("userId", userId);
      if (traits != null) payload.put("traits", traits);
      return new EventPayload(payload);
    }
  }

  private static final class Json {
    static String write(Object value) {
      if (value == null) return "null";
      if (value instanceof String s) return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
      if (value instanceof Number || value instanceof Boolean) return value.toString();
      if (value instanceof Map<?, ?> map) return object(map);
      if (value instanceof List<?> list) return array(list);
      return write(value.toString());
    }

    private static String object(Map<?, ?> map) {
      StringJoiner joiner = new StringJoiner(",", "{", "}");
      map.forEach((key, value) -> joiner.add(write(key.toString()) + ":" + write(value)));
      return joiner.toString();
    }

    private static String array(List<?> list) {
      StringJoiner joiner = new StringJoiner(",", "[", "]");
      list.forEach(value -> joiner.add(write(value)));
      return joiner.toString();
    }
  }
}

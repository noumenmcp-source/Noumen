package com.cdpus.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class CdpClientTest {
  @Test
  void postsTrackPayloadToTrackEndpoint() {
    FakeTransport transport = new FakeTransport(202);
    CdpClient client = CdpClient.builder().writeKey("wk_us").endpoint("https://api.example.com").transport(transport).build();

    client.track("anon_1", "Signed Up", Map.of("plan", "growth"));
    client.flush();

    assertEquals("https://api.example.com/v1/track", transport.urls.get(0));
    assertTrue(transport.bodies.get(0).contains("\"writeKey\":\"wk_us\""));
    assertTrue(transport.bodies.get(0).contains("\"events\""));
  }

  @Test
  void flushesAtThresholdAndCloseFlushes() {
    FakeTransport transport = new FakeTransport(202, 202);
    CdpClient client = CdpClient.builder().writeKey("wk").flushAt(2).transport(transport).build();
    client.track("a", "One", Map.of());
    client.identify("a", Map.of("email", "buyer@example.com"), "u1");
    assertEquals(1, transport.bodies.size());
    client.track("a", "Buffered", Map.of());
    client.close();
    assertEquals(2, transport.bodies.size());
  }

  @Test
  void retriesFiveHundredButNotFourHundred() {
    FakeTransport retry = new FakeTransport(500, 202);
    CdpClient.builder().writeKey("wk").flushAt(1).transport(retry).retryDelayMs(0).build().track("a", "Retry", Map.of());
    assertEquals(2, retry.bodies.size());

    FakeTransport bad = new FakeTransport(400, 202);
    CdpClient client = CdpClient.builder().writeKey("wk").flushAt(1).transport(bad).build();
    assertThrows(CdpException.class, () -> client.track("a", "Bad", Map.of()));
    assertEquals(1, bad.bodies.size());
  }

  static final class FakeTransport implements Transport {
    final List<Integer> statuses;
    final List<String> urls = new ArrayList<>();
    final List<String> bodies = new ArrayList<>();

    FakeTransport(Integer... statuses) {
      this.statuses = new ArrayList<>(List.of(statuses));
    }

    @Override
    public int send(String url, String jsonBody) throws IOException {
      urls.add(url);
      bodies.add(jsonBody);
      return statuses.isEmpty() ? 202 : statuses.remove(0);
    }
  }
}

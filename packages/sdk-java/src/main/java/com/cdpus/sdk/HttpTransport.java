package com.cdpus.sdk;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public final class HttpTransport implements Transport {
  private final HttpClient client = HttpClient.newHttpClient();

  @Override
  public int send(String url, String jsonBody) throws IOException, InterruptedException {
    HttpRequest request = HttpRequest.newBuilder(URI.create(url))
        .header("content-type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
        .build();
    return client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
  }
}

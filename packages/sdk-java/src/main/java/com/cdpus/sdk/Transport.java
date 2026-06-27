package com.cdpus.sdk;

import java.io.IOException;

public interface Transport {
  /**
   * Sends a JSON request body to the CDP endpoint.
   *
   * @param url full /v1/track URL
   * @param jsonBody serialized batch
   * @return HTTP status code
   */
  int send(String url, String jsonBody) throws IOException, InterruptedException;
}

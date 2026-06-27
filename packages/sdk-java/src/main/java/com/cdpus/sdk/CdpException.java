package com.cdpus.sdk;

public final class CdpException extends RuntimeException {
  public CdpException(String message) {
    super(message);
  }

  public CdpException(String message, Throwable cause) {
    super(message, cause);
  }
}

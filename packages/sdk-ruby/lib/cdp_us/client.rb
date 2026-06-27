# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

module CdpUs
  class HttpTransport
    def send(url, json_body)
      uri = URI(url)
      request = Net::HTTP::Post.new(uri)
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(json_body)
      Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") { |http| http.request(request).code.to_i }
    end
  end

  class CdpClient
    DEFAULT_ENDPOINT = "http://localhost:8110"
    MAX_BATCH_SIZE = 500

    # @example
    #   client = CdpUs::CdpClient.new(write_key: "wk")
    def initialize(write_key:, endpoint: DEFAULT_ENDPOINT, flush_at: 20, transport: nil, max_retries: 2, backoff_seconds: 0.1)
      @write_key = write_key
      @endpoint = endpoint.sub(%r{/$}, "")
      @flush_at = [[flush_at, 1].max, MAX_BATCH_SIZE].min
      @transport = transport || HttpTransport.new
      @max_retries = max_retries
      @backoff_seconds = backoff_seconds
      @buffer = []
    end

    # @example
    #   client.track("anon_1", "Signed Up", plan: "pro")
    def track(anonymous_id, event, properties = {})
      enqueue("type" => "track", "anonymousId" => anonymous_id, "event" => event, "properties" => properties)
    end

    # @example
    #   client.identify("anon_1", { email: "buyer@example.com" }, "user_1")
    def identify(anonymous_id, traits = {}, user_id = nil)
      event = { "type" => "identify", "anonymousId" => anonymous_id, "traits" => traits }
      event["userId"] = user_id if user_id
      enqueue(event)
    end

    # @example
    #   client.flush
    def flush
      until @buffer.empty?
        send_batch(@buffer.shift(MAX_BATCH_SIZE))
      end
      true
    end

    # @example
    #   client.close
    def close
      flush
    end

    private

    def enqueue(event)
      @buffer << event
      flush if @buffer.length >= @flush_at
      true
    end

    def send_batch(events)
      retrying do
        code = @transport.send("#{@endpoint}/v1/track", "writeKey" => @write_key, "events" => events)
        raise RetryableStatus, code if code >= 500
        raise ClientStatus, code if code >= 400
        code
      end
    end

    def retrying
      attempts = 0
      begin
        yield
      rescue RetryableStatus, IOError, SystemCallError
        attempts += 1
        raise if attempts > @max_retries

        sleep(@backoff_seconds * (2**(attempts - 1)))
        retry
      end
    end
  end

  class RetryableStatus < StandardError
    attr_reader :status

    def initialize(status)
      @status = status
      super("retryable status #{status}")
    end
  end

  class ClientStatus < StandardError
    attr_reader :status

    def initialize(status)
      @status = status
      super("client status #{status}")
    end
  end
end

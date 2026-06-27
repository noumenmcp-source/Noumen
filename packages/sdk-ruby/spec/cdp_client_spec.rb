# frozen_string_literal: true

require "cdp_us"

RSpec.describe CdpUs::CdpClient do
  it "posts track and identify payloads to /v1/track" do
    transport = FakeTransport.new([202])
    client = described_class.new(write_key: "wk_test", endpoint: "http://collector.test", flush_at: 10, transport: transport)

    client.track("anon_1", "Signed Up", "plan" => "pro")
    client.identify("anon_1", { "email" => "buyer@example.com" }, "user_1")
    client.flush

    expect(transport.calls.first[:url]).to eq("http://collector.test/v1/track")
    expect(transport.calls.first[:body]).to eq(
      "writeKey" => "wk_test",
      "events" => [
        { "type" => "track", "anonymousId" => "anon_1", "event" => "Signed Up", "properties" => { "plan" => "pro" } },
        { "type" => "identify", "anonymousId" => "anon_1", "traits" => { "email" => "buyer@example.com" }, "userId" => "user_1" }
      ]
    )
  end

  it "flushes automatically at flush_at and close sends remaining events" do
    transport = FakeTransport.new([202, 202])
    client = described_class.new(write_key: "wk", flush_at: 2, transport: transport)

    client.track("a1", "One")
    client.track("a2", "Two")
    client.track("a3", "Three")
    client.close

    expect(transport.calls.map { |call| call[:body]["events"].length }).to eq([2, 1])
  end

  it "retries 5xx and does not retry 4xx" do
    retry_transport = FakeTransport.new([500, 202])
    client = described_class.new(write_key: "wk", transport: retry_transport, backoff_seconds: 0)

    client.track("a1", "One")
    client.flush
    expect(retry_transport.calls.length).to eq(2)

    bad_transport = FakeTransport.new([400, 202])
    bad_client = described_class.new(write_key: "wk", transport: bad_transport, backoff_seconds: 0)
    bad_client.track("a1", "One")
    expect { bad_client.flush }.to raise_error(CdpUs::ClientStatus)
    expect(bad_transport.calls.length).to eq(1)
  end
end

class FakeTransport
  attr_reader :calls

  def initialize(statuses)
    @statuses = statuses
    @calls = []
  end

  def send(url, json_body)
    @calls << { url: url, body: json_body }
    @statuses.shift || 202
  end
end

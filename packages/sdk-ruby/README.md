# CDP-US Ruby SDK

Server-side Ruby SDK for posting `track` and `identify` events to `/v1/track`.

```ruby
client = CdpUs::CdpClient.new(write_key: "wk_live")
client.track("anon_1", "Signed Up", plan: "pro")
client.identify("anon_1", { email: "buyer@example.com" }, "user_1")
client.close
```

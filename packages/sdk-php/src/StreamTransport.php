<?php

declare(strict_types=1);

namespace CdpUs;

final class StreamTransport implements Transport
{
    /**
     * Sends a POST request using PHP streams.
     *
     * @example
     * $transport = new StreamTransport();
     * $transport->send('https://api.example.com/v1/track', '{"writeKey":"wk","events":[]}');
     */
    public function send(string $url, string $jsonBody): int
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $jsonBody,
                'ignore_errors' => true,
                'timeout' => 10,
            ],
        ]);

        $result = @file_get_contents($url, false, $context);
        if ($result === false && empty($http_response_header)) {
            throw new TransportException('CDP request failed before receiving a response.');
        }

        return $this->statusCode($http_response_header ?? []);
    }

    /**
     * @param array<int, string> $headers
     */
    private function statusCode(array $headers): int
    {
        $status = $headers[0] ?? '';
        if (preg_match('/\s(\d{3})\s/', $status, $matches) !== 1) {
            throw new TransportException('CDP response did not include an HTTP status code.');
        }

        return (int) $matches[1];
    }
}

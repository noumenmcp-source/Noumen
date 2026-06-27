<?php

declare(strict_types=1);

namespace CdpUs\Tests;

use CdpUs\Transport;
use CdpUs\TransportException;

final class FakeTransport implements Transport
{
    /** @var list<array{url: string, body: string}> */
    public array $requests = [];

    /** @param list<int|TransportException> $responses */
    public function __construct(private array $responses = [202])
    {
    }

    public function send(string $url, string $jsonBody): int
    {
        $this->requests[] = ['url' => $url, 'body' => $jsonBody];
        $response = array_shift($this->responses) ?? 202;
        if ($response instanceof TransportException) {
            throw $response;
        }

        return $response;
    }

    /** @return array<string, mixed> */
    public function lastPayload(): array
    {
        $body = $this->requests[array_key_last($this->requests)]['body'] ?? '{}';
        $payload = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($payload)) {
            throw new TransportException('Expected JSON object payload.');
        }

        return $payload;
    }
}

<?php

declare(strict_types=1);

namespace CdpUs;

use JsonException;
use RuntimeException;

final class CdpClient
{
    private const DEFAULT_ENDPOINT = 'http://localhost:8110';
    private const MAX_BATCH_SIZE = 500;

    /** @var list<array<string, mixed>> */
    private array $buffer = [];
    private string $trackUrl;
    private Transport $transport;

    public function __construct(
        private readonly string $writeKey,
        string $endpoint = self::DEFAULT_ENDPOINT,
        private readonly int $flushAt = 20,
        ?Transport $transport = null,
        private readonly int $maxRetries = 2,
        private readonly int $retryDelayMs = 100,
    ) {
        $this->trackUrl = $this->trackUrl($endpoint);
        $this->transport = $transport ?? new StreamTransport();
    }

    /**
     * Queues a track event and flushes when the batch threshold is reached.
     *
     * @example
     * $client->track('anon_123', 'Signed Up', ['plan' => 'growth']);
     *
     * @param array<string, mixed>|null $properties
     */
    public function track(string $anonymousId, string $event, ?array $properties = null): void
    {
        $payload = ['type' => 'track', 'anonymousId' => $anonymousId, 'event' => $event];
        if ($properties !== null) {
            $payload['properties'] = $properties;
        }

        $this->enqueue($payload);
    }

    /**
     * Queues an identify event and flushes when the batch threshold is reached.
     *
     * @example
     * $client->identify('anon_123', ['email' => 'buyer@example.com'], 'user_123');
     *
     * @param array<string, mixed>|null $traits
     */
    public function identify(string $anonymousId, ?array $traits = null, ?string $userId = null): void
    {
        $payload = ['type' => 'identify', 'anonymousId' => $anonymousId];
        if ($userId !== null) {
            $payload['userId'] = $userId;
        }
        if ($traits !== null) {
            $payload['traits'] = $traits;
        }

        $this->enqueue($payload);
    }

    /** @example $client->flush(); */
    public function flush(): void
    {
        while ($this->buffer !== []) {
            $events = array_splice($this->buffer, 0, self::MAX_BATCH_SIZE);
            try {
                $this->postBatch($events);
            } catch (RuntimeException $error) {
                array_unshift($this->buffer, ...$events);
                throw $error;
            }
        }
    }

    /** @example $client->close(); */
    public function close(): void
    {
        $this->flush();
    }

    /**
     * @param array<string, mixed> $event
     */
    private function enqueue(array $event): void
    {
        $this->buffer[] = $event;
        if (count($this->buffer) >= $this->boundedFlushAt()) {
            $this->flush();
        }
    }

    /**
     * @param list<array<string, mixed>> $events
     */
    private function postBatch(array $events): void
    {
        $json = $this->encode(['writeKey' => $this->writeKey, 'events' => $events]);
        for ($attempt = 0; $attempt <= $this->maxRetries; $attempt++) {
            if ($this->trySend($json, $attempt)) {
                return;
            }
        }
    }

    private function trySend(string $json, int $attempt): bool
    {
        try {
            $status = $this->transport->send($this->trackUrl, $json);
        } catch (TransportException $error) {
            return $this->retryOrThrow($attempt, $error);
        }

        if ($status >= 500) {
            return $this->retryOrThrow($attempt, new TransportException("CDP retryable {$status}"));
        }
        if ($status >= 400) {
            throw new TransportException("CDP rejected {$status}");
        }

        return true;
    }

    private function retryOrThrow(int $attempt, TransportException $error): bool
    {
        if ($attempt >= $this->maxRetries) {
            throw $error;
        }
        if ($this->retryDelayMs > 0) {
            usleep($this->retryDelayMs * 1000 * (2 ** $attempt));
        }

        return false;
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function encode(array $payload): string
    {
        try {
            return json_encode($payload, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new TransportException('CDP payload could not be encoded.', 0, $error);
        }
    }

    private function boundedFlushAt(): int
    {
        return min(max($this->flushAt, 1), self::MAX_BATCH_SIZE);
    }

    private function trackUrl(string $endpoint): string
    {
        $trimmed = rtrim($endpoint, '/');
        return str_ends_with($trimmed, '/v1/track') ? $trimmed : "{$trimmed}/v1/track";
    }
}

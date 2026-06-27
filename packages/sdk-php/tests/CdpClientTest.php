<?php

declare(strict_types=1);

namespace CdpUs\Tests;

use CdpUs\CdpClient;
use CdpUs\TransportException;
use PHPUnit\Framework\TestCase;

final class CdpClientTest extends TestCase
{
    public function testPostsTrackPayloadToTrackEndpoint(): void
    {
        $transport = new FakeTransport();
        $client = new CdpClient('wk_us', 'https://api.example.com', 20, $transport);

        $client->track('anon_1', 'Signed Up', ['plan' => 'growth']);
        $client->flush();

        self::assertSame('https://api.example.com/v1/track', $transport->requests[0]['url']);
        self::assertSame('wk_us', $transport->lastPayload()['writeKey']);
        self::assertSame('track', $transport->lastPayload()['events'][0]['type']);
    }

    public function testFlushesWhenBufferReachesFlushAt(): void
    {
        $transport = new FakeTransport();
        $client = new CdpClient('wk_us', 'http://localhost:8110', 2, $transport);

        $client->track('anon_1', 'One');
        $client->identify('anon_1', ['email' => 'buyer@example.com'], 'user_1');

        self::assertCount(1, $transport->requests);
        self::assertCount(2, $transport->lastPayload()['events']);
    }

    public function testRetriesFiveHundredThenSucceeds(): void
    {
        $transport = new FakeTransport([500, 202]);
        $client = new CdpClient('wk_us', 'http://localhost:8110', 1, $transport, retryDelayMs: 0);

        $client->track('anon_1', 'Retry');

        self::assertCount(2, $transport->requests);
    }

    public function testDoesNotRetryFourHundred(): void
    {
        $transport = new FakeTransport([400, 202]);
        $client = new CdpClient('wk_us', 'http://localhost:8110', 1, $transport);

        $this->expectException(TransportException::class);
        $this->expectExceptionMessage('CDP rejected 400');

        try {
            $client->track('anon_1', 'Bad');
        } finally {
            self::assertCount(1, $transport->requests);
        }
    }

    public function testCloseFlushesBufferedEvents(): void
    {
        $transport = new FakeTransport();
        $client = new CdpClient('wk_us', 'http://localhost:8110', 20, $transport);

        $client->track('anon_1', 'Buffered');
        $client->close();

        self::assertCount(1, $transport->requests);
        self::assertSame('Buffered', $transport->lastPayload()['events'][0]['event']);
    }
}

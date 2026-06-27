<?php

declare(strict_types=1);

namespace CdpUs;

interface Transport
{
    /**
     * Sends a JSON body to the CDP endpoint.
     *
     * @example
     * $status = $transport->send('https://api.example.com/v1/track', '{"events":[]}');
     */
    public function send(string $url, string $jsonBody): int;
}

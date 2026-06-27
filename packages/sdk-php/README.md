# CDP-US PHP SDK

Server-side PHP ingestion client for CDP-US. It posts batches to `/v1/track` and supports injected transports for tests or framework-specific HTTP clients.

```php
<?php

use CdpUs\CdpClient;

$client = new CdpClient('wk_live', 'https://api.example.com', 20);
$client->track('anon_123', 'Order Completed', ['value' => 199, 'currency' => 'USD']);
$client->identify('anon_123', ['email' => 'buyer@example.com'], 'user_123');
$client->close();
```

Run tests:

```bash
composer install
composer test
```

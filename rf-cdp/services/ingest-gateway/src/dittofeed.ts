import { request } from 'undici';
import { randomUUID } from 'crypto';
import { config } from './config';

const PUBLIC_API_PREFIX = '/api/public/apps';

interface Workspace {
  workspaceId?: string;
  // already the base64(secretId:value) public write token from Dittofeed — sent verbatim
  dittofeedWriteKey: string;
}

// Resolve a client-facing write key (x-write-key header) to its Dittofeed workspace token.
function resolveWorkspace(writeKey: string): Workspace {
  const map = config.WRITE_KEYS as Record<string, Workspace>;
  const ws = map[writeKey];
  if (!ws || !ws.dittofeedWriteKey) {
    const err: any = new Error('Unknown write key');
    err.status = 401;
    throw err;
  }
  return ws;
}

async function send(type: string, dittofeedWriteKey: string, payload: object): Promise<void> {
  const url = `${config.DITTOFEED_API}${PUBLIC_API_PREFIX}/${type}`;
  const body = JSON.stringify(payload);
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await request(url, {
      method: 'POST',
      headers: { authorization: `Basic ${dittofeedWriteKey}`, 'content-type': 'application/json' },
      body,
    });
    const code = res.statusCode;
    await res.body.dump(); // drain the body to free the socket
    if (code >= 200 && code < 400) return;
    if (code >= 500 && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
      continue;
    }
    const err: any = new Error(`Dittofeed responded ${code}`);
    err.status = code === 401 ? 401 : code >= 500 ? 502 : code;
    throw err;
  }
}

export async function ingestIdentify(writeKey: string, data: any): Promise<void> {
  const ws = resolveWorkspace(writeKey);
  await send('identify', ws.dittofeedWriteKey, {
    type: 'identify',
    messageId: randomUUID(),
    userId: data.userId,
    anonymousId: data.anonymousId,
    traits: data.traits ?? {},
  });
}

export async function ingestTrack(writeKey: string, data: any): Promise<void> {
  const ws = resolveWorkspace(writeKey);
  await send('track', ws.dittofeedWriteKey, {
    type: 'track',
    messageId: randomUUID(),
    userId: data.userId,
    anonymousId: data.anonymousId,
    event: data.event,
    properties: data.properties ?? {},
    timestamp: data.timestamp,
  });
}

export async function ingestBatch(writeKey: string, batch: any[]): Promise<void> {
  for (const item of batch) {
    if (item.type === 'identify') await ingestIdentify(writeKey, item);
    else if (item.type === 'track') await ingestTrack(writeKey, item);
  }
}

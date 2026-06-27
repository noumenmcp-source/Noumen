import type { HttpRequest, HttpResponse, HttpTransport, JsonRecord } from "./types.js";

const DEFAULT_ENDPOINT = "http://localhost:8110";

export function normalizeEndpoint(value?: string): string {
  return (value ?? process.env.CDP_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
}

export function buildUrl(endpoint: string, path: string, query?: Readonly<Record<string, string>>): string {
  const url = new URL(path, `${normalizeEndpoint(endpoint)}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function createFetchTransport(): HttpTransport {
  return async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
    });
    return { status: response.status, body: await readBody(response) };
  };
}

export async function requestJson(
  transport: HttpTransport,
  request: HttpRequest,
): Promise<HttpResponse> {
  const headers = { ...(request.headers ?? {}) };
  if (request.body) headers["content-type"] = "application/json";
  return transport({ ...request, headers });
}

export function bearer(token: string): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${token}` };
}

export function trackBody(writeKey: string, event: JsonRecord): JsonRecord {
  return { writeKey, events: [event] };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

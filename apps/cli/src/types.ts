export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonRecord = Readonly<Record<string, JsonValue>>;

export type CliConfig = Readonly<{
  endpoint: string;
  tenantId: string;
  token: string;
  writeKey?: string;
}>;

export type HttpRequest = Readonly<{
  method: "GET" | "POST";
  url: string;
  headers?: Readonly<Record<string, string>>;
  body?: JsonRecord;
}>;

export type HttpResponse = Readonly<{ status: number; body: unknown }>;

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export type Output = Readonly<{
  write(message: string): void;
  error(message: string): void;
}>;

export type CliRuntime = Readonly<{
  argv: readonly string[];
  configDir?: string;
  transport?: HttpTransport;
  output?: Output;
}>;

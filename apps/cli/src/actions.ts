import type { Command } from "commander";
import { clearConfig, readConfig, writeConfig } from "./config.js";
import { CliError, ensureOk, print } from "./format.js";
import { bearer, buildUrl, requestJson, trackBody } from "./http.js";
import { endpoint, expectOptions, isJson, optionalString, optionList, required } from "./options.js";
import { parsePairs } from "./parse.js";
import type { CliConfig, HttpTransport, JsonRecord, Output } from "./types.js";

export async function signup(
  program: Command,
  transport: HttpTransport,
  output: Output,
  opts: unknown,
): Promise<void> {
  const options = expectOptions(opts);
  const response = await requestJson(transport, {
    method: "POST",
    url: buildUrl(endpoint(program), "/v1/signup"),
    body: { companyName: required(options.company), ownerEmail: required(options.email) },
  });
  ensureOk(response.status, response.body);
  print(output, isJson(program), response.body);
}

export async function login(
  program: Command,
  output: Output,
  configDir: string | undefined,
  opts: unknown,
): Promise<void> {
  const options = expectOptions(opts);
  const config = {
    endpoint: optionalString(options.endpoint) ?? endpoint(program),
    tenantId: required(options.tenant),
    token: required(options.token),
    writeKey: optionalString(options.writeKey),
  };
  await writeConfig(config, configDir);
  print(output, isJson(program), { ok: true, tenantId: config.tenantId });
}

export async function logout(output: Output, configDir: string | undefined): Promise<void> {
  await clearConfig(configDir);
  print(output, false, "Logged out");
}

export async function listModules(
  program: Command,
  transport: HttpTransport,
  output: Output,
): Promise<void> {
  const response = await requestJson(transport, {
    method: "GET",
    url: buildUrl(endpoint(program), "/v1/modules"),
  });
  ensureOk(response.status, response.body);
  print(output, isJson(program), response.body);
}

export async function enableModule(
  program: Command,
  transport: HttpTransport,
  output: Output,
  configDir: string | undefined,
  key: string,
): Promise<void> {
  const config = await requireConfig(configDir);
  const response = await requestJson(transport, {
    method: "POST",
    url: buildUrl(config.endpoint, `/v1/tenants/${config.tenantId}/modules/${key}`),
    headers: bearer(config.token),
  });
  ensureOk(response.status, response.body);
  print(output, isJson(program), response.body);
}

export async function health(
  program: Command,
  transport: HttpTransport,
  output: Output,
): Promise<void> {
  const response = await requestJson(transport, {
    method: "GET",
    url: buildUrl(endpoint(program), "/v1/health"),
  });
  ensureOk(response.status, response.body);
  print(output, isJson(program), response.body);
}

export async function sendEvent(
  program: Command,
  transport: HttpTransport,
  output: Output,
  configDir: string | undefined,
  event: JsonRecord,
): Promise<void> {
  const config = await requireConfig(configDir);
  if (!config.writeKey) throw new CliError("Missing writeKey. Run login with --write-key.");
  const response = await requestJson(transport, {
    method: "POST",
    url: buildUrl(config.endpoint, "/v1/track"),
    body: trackBody(config.writeKey, event),
  });
  ensureOk(response.status, response.body);
  print(output, isJson(program), response.body);
}

export async function authedGet(
  program: Command,
  transport: HttpTransport,
  output: Output,
  config: CliConfig,
  path: string,
  query?: Readonly<Record<string, string>>,
): Promise<void> {
  const response = await requestJson(transport, {
    method: "GET",
    url: buildUrl(config.endpoint, path, query),
    headers: bearer(config.token),
  });
  ensureOk(response.status, response.body);
  print(output, isJson(program), response.body);
}

export async function requireConfig(configDir?: string): Promise<CliConfig> {
  const config = await readConfig(configDir);
  if (!config) throw new CliError("Not logged in. Run cdp login first.");
  return config;
}

export function track(anonymousId: string, event: string, opts: unknown): JsonRecord {
  return { type: "track", anonymousId, event, properties: parsePairs(optionList(expectOptions(opts).prop)) };
}

export function identify(anonymousId: string, opts: unknown): JsonRecord {
  return { type: "identify", anonymousId, traits: parsePairs(optionList(expectOptions(opts).trait)) };
}

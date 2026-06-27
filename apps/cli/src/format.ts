import type { Output } from "./types.js";

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export function print(output: Output, json: boolean, value: unknown): void {
  output.write(json ? JSON.stringify(value) : human(value));
}

export function ensureOk(status: number, body: unknown): void {
  if (status >= 400) throw new CliError(`API request failed with status ${status}: ${describe(body)}`);
}

export const consoleOutput: Output = {
  write: (message) => console.log(message),
  error: (message) => console.error(message),
};

function human(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

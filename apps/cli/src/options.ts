import type { Command } from "commander";
import { CliError } from "./format.js";
import type { Output } from "./types.js";

type OptionValue = string | readonly string[] | undefined;
type GlobalOptions = Readonly<{ json?: boolean; endpoint?: string }>;

export function endpoint(program: Command): string {
  return String(program.opts<GlobalOptions>().endpoint ?? process.env.CDP_ENDPOINT ?? "http://localhost:8110");
}

export function isJson(program: Command): boolean {
  return program.opts<GlobalOptions>().json === true;
}

export function handleError(error: unknown, output: Output): number {
  if (error instanceof CliError) {
    output.error(error.message);
    return error.exitCode;
  }
  if (isCommanderExit(error)) return error.exitCode;
  output.error(error instanceof Error ? error.message : "Unknown error");
  return 1;
}

export function expectOptions(value: unknown): Record<string, OptionValue> {
  return typeof value === "object" && value !== null ? (value as Record<string, OptionValue>) : {};
}

export function required(value: OptionValue): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new CliError("Missing required option");
}

export function optionalString(value: OptionValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function optionList(value: OptionValue): readonly string[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function isCommanderExit(error: unknown): error is Readonly<{ exitCode: number }> {
  return typeof error === "object" && error !== null && "exitCode" in error;
}

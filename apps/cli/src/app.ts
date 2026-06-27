import { Command } from "commander";
import {
  authedGet,
  enableModule,
  health,
  identify,
  listModules,
  login,
  logout,
  requireConfig,
  sendEvent,
  signup,
  track,
} from "./actions.js";
import { consoleOutput } from "./format.js";
import { createFetchTransport } from "./http.js";
import { handleError, isJson } from "./options.js";
import type { CliRuntime, HttpTransport, Output } from "./types.js";

/**
 * Runs the CDP-US developer CLI.
 *
 * @example
 * await runCli(["health"], { transport: fakeTransport });
 */
export async function runCli(runtime: CliRuntime): Promise<number> {
  const output = runtime.output ?? consoleOutput;
  const transport = runtime.transport ?? createFetchTransport();
  const program = createProgram(runtime, transport, output);
  try {
    await program.parseAsync(["node", "cdp", ...runtime.argv]);
    return 0;
  } catch (error) {
    return handleError(error, output);
  }
}

export function createProgram(runtime: CliRuntime, transport: HttpTransport, output: Output): Command {
  const program = new Command();
  program.exitOverride();
  program.name("cdp").option("--json", "print JSON output").option("--endpoint <url>");
  program
    .command("signup")
    .requiredOption("--company <name>")
    .requiredOption("--email <email>")
    .action((opts) => signup(program, transport, output, opts));
  program
    .command("login")
    .requiredOption("--token <token>")
    .requiredOption("--tenant <id>")
    .option("--write-key <key>")
    .option("--endpoint <url>")
    .action((opts) => login(program, output, runtime.configDir, opts));
  program.command("logout").action(() => logout(output, runtime.configDir));
  modules(program, transport, output, runtime.configDir);
  ingest(program, transport, output, runtime.configDir);
  reads(program, transport, output, runtime.configDir);
  program.command("health").action(() => health(program, transport, output));
  return program;
}

function modules(program: Command, transport: HttpTransport, output: Output, configDir?: string): void {
  const command = program.command("modules");
  command.action(() => call(program, output, () => listModules(program, transport, output)));
  command.command("enable <key>").action((key: string) =>
    call(program, output, () => enableModule(program, transport, output, configDir, key)),
  );
}

function ingest(program: Command, transport: HttpTransport, output: Output, configDir?: string): void {
  program
    .command("track <anonymousId> <event>")
    .option("--prop <pair...>")
    .action((anonymousId: string, event: string, opts: unknown) =>
      call(program, output, () => sendEvent(program, transport, output, configDir, track(anonymousId, event, opts))),
    );
  program
    .command("identify <anonymousId>")
    .option("--trait <pair...>")
    .action((anonymousId: string, opts: unknown) =>
      call(program, output, () => sendEvent(program, transport, output, configDir, identify(anonymousId, opts))),
    );
}

function reads(program: Command, transport: HttpTransport, output: Output, configDir?: string): void {
  program.command("profiles").action(() =>
    call(program, output, async () => {
      const config = await requireConfig(configDir);
      await authedGet(program, transport, output, config, `/v1/tenants/${config.tenantId}/profiles`);
    }),
  );
  program.command("events").option("--anon <id>").action((opts: unknown) =>
    call(program, output, async () => {
      const config = await requireConfig(configDir);
      const anon = typeof opts === "object" && opts !== null && "anon" in opts ? String(opts.anon ?? "") : "";
      await authedGet(program, transport, output, config, `/v1/tenants/${config.tenantId}/events`, {
        anonymousId: anon,
      });
    }),
  );
}

async function call(program: Command, output: Output, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const code = handleError(error, output);
    program.error("", { exitCode: code });
  }
}

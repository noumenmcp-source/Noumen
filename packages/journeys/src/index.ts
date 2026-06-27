import type { IngestEvent, Profile } from "@cdp-us/contracts";

/** @example const ctx: JourneyContext = { profile, events: [] }; */
export type JourneyContext = Readonly<{ profile: Profile; events: readonly IngestEvent[] }>;

/** @example const predicate: JourneyPredicate = (ctx) => Boolean(ctx.profile.email); */
export type JourneyPredicate = (context: JourneyContext) => boolean;

/** @example const outcome: StepOutcome = { status: "sent" }; */
export type StepOutcome = Readonly<{ status: string; data?: unknown }>;

/** @example const executor: JourneyExecutor = async () => ({ status: "ok" }); */
export type JourneyExecutor = (params: Record<string, unknown>, context: JourneyContext) => StepOutcome | Promise<StepOutcome>;

/** @example const step: JourneyStep = { key: "send", type: "action", executor: "email", params: {} }; */
export type JourneyStep = EnterStep | WaitStep | BranchStep | ActionStep | ExitStep;

export type EnterStep = Readonly<{ key: string; type: "enter"; when: JourneyPredicate; next?: string }>;
export type WaitStep = Readonly<{ key: string; type: "wait"; delaySeconds: number; next?: string }>;
export type BranchStep = Readonly<{ key: string; type: "branch"; when: JourneyPredicate; trueStep?: string; falseStep?: string }>;
export type ActionStep = Readonly<{ key: string; type: "action"; executor: string; params: Record<string, unknown>; next?: string }>;
export type ExitStep = Readonly<{ key: string; type: "exit" }>;

/** @example const def: JourneyDefinition = { key: "welcome", steps: [] }; */
export type JourneyDefinition = Readonly<{ key: string; steps: readonly JourneyStep[] }>;

/** @example const result: StepResult = { key: "wait", type: "wait", status: "waited" }; */
export type StepResult = Readonly<{ key: string; type: JourneyStep["type"]; status: string; outcome?: StepOutcome }>;

/** @example const run: JourneyRun = await runJourney(def, context, executors); */
export type JourneyRun = Readonly<{ journeyKey: string; status: "completed" | "halted" | "rejected"; results: readonly StepResult[] }>;

/** @example const opts: JourneyRunOptions = { maxSteps: 50 }; */
export type JourneyRunOptions = Readonly<{ maxSteps?: number }>;

/** @example const run = await runJourney(def, context, { email: executor }); */
export async function runJourney(
  definition: JourneyDefinition,
  context: JourneyContext,
  executors: Readonly<Record<string, JourneyExecutor>>,
  opts: JourneyRunOptions = {},
): Promise<JourneyRun> {
  const byKey = new Map(definition.steps.map((step) => [step.key, step]));
  const results: StepResult[] = [];
  let current = definition.steps[0]?.key;
  const maxSteps = opts.maxSteps ?? 100;

  for (let count = 0; current && count < maxSteps; count += 1) {
    const step = byKey.get(current);
    if (!step) return finish(definition.key, "halted", results);
    const next = await executeStep(step, context, executors, results);
    if (step.type === "enter" && results.at(-1)?.status === "rejected") return finish(definition.key, "rejected", results);
    if (step.type === "exit") return finish(definition.key, "completed", results);
    current = next ?? nextSequential(definition.steps, step.key) ?? "";
  }

  return finish(definition.key, "halted", results);
}

async function executeStep(
  step: JourneyStep,
  context: JourneyContext,
  executors: Readonly<Record<string, JourneyExecutor>>,
  results: StepResult[],
): Promise<string | undefined> {
  if (step.type === "enter") return enter(step, context, results);
  if (step.type === "wait") return waited(step, results);
  if (step.type === "branch") return branch(step, context, results);
  if (step.type === "action") return action(step, context, executors, results);
  results.push({ key: step.key, type: step.type, status: "exited" });
  return undefined;
}

function enter(step: EnterStep, context: JourneyContext, results: StepResult[]): string | undefined {
  const accepted = step.when(context);
  results.push({ key: step.key, type: step.type, status: accepted ? "entered" : "rejected" });
  return accepted ? step.next : undefined;
}

function waited(step: WaitStep, results: StepResult[]): string | undefined {
  results.push({ key: step.key, type: step.type, status: "waited" });
  return step.next;
}

function branch(step: BranchStep, context: JourneyContext, results: StepResult[]): string | undefined {
  const matched = step.when(context);
  results.push({ key: step.key, type: step.type, status: matched ? "true" : "false" });
  return matched ? step.trueStep : step.falseStep;
}

async function action(
  step: ActionStep,
  context: JourneyContext,
  executors: Readonly<Record<string, JourneyExecutor>>,
  results: StepResult[],
): Promise<string | undefined> {
  const executor = executors[step.executor];
  if (!executor) {
    results.push({ key: step.key, type: step.type, status: "missing_executor" });
    return step.next;
  }
  const outcome = await executor(step.params, context);
  results.push({ key: step.key, type: step.type, status: "acted", outcome });
  return step.next;
}

function nextSequential(steps: readonly JourneyStep[], key: string): string | undefined {
  const index = steps.findIndex((step) => step.key === key);
  return index >= 0 ? steps[index + 1]?.key : undefined;
}

function finish(journeyKey: string, status: JourneyRun["status"], results: readonly StepResult[]): JourneyRun {
  return { journeyKey, status, results };
}

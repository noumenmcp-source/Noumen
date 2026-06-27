export type ModuleKey =
  | "email"
  | "social-intel"
  | "automation"
  | "consent"
  | string;

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly writeKey: string;
  readonly region: "us";
  readonly enabledModules: readonly ModuleKey[];
  readonly createdAt: string;
}

export interface Owner {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: string;
  readonly createdAt: string;
}

export interface ModuleManifest {
  readonly key: ModuleKey;
  readonly title: string;
  readonly description: string;
  readonly requiresConsent: readonly string[];
}

export interface Health {
  readonly status: string;
  readonly region: string;
  readonly counters: {
    readonly received: number;
    readonly stored: number;
    readonly suppressed: number;
    readonly failed: number;
  };
}

export interface Profile {
  readonly id: string;
  readonly anonymousId?: string;
  readonly userId?: string;
  readonly email?: string;
  readonly firmographics: {
    readonly company?: string;
    readonly domain?: string;
    readonly industry?: string;
  };
  readonly intent: {
    readonly score?: number;
    readonly lastActiveAt?: string;
  };
  readonly traits: Record<string, unknown>;
}

export interface TimelineEvent {
  readonly id: string;
  readonly anonymousId: string;
  readonly type: string;
  readonly name?: string;
  readonly properties: Record<string, unknown>;
  readonly ts: string;
}

export interface Session {
  readonly apiToken: string;
  readonly tenant: Tenant | null;
  readonly tenantId: string;
}

export interface SegmentPredicate {
  readonly path: string;
  readonly equals: unknown;
}

export interface AudienceEvaluateBody {
  readonly name?: string;
  readonly rule: readonly SegmentPredicate[];
  readonly sampleSize?: number;
  readonly against?: readonly SegmentPredicate[];
}

export interface AudienceResult {
  readonly ok: boolean;
  readonly tenantId: string;
  readonly key: string;
  readonly size: number;
  readonly sampleIds: readonly string[];
  readonly overlap?: {
    readonly aOnly: number;
    readonly bOnly: number;
    readonly both: number;
  };
}

export interface JourneyStepResult {
  readonly key: string;
  readonly type: string;
  readonly status: string;
  readonly outcome?: unknown;
}

export interface JourneyResult {
  readonly journeyKey: string;
  readonly status: "completed" | "halted" | "rejected";
  readonly results: readonly JourneyStepResult[];
}

export interface FunnelStep {
  readonly step: string;
  readonly count: number;
  readonly dropoff: number;
}

export interface RetentionPoint {
  readonly day: number;
  readonly rate: number;
}

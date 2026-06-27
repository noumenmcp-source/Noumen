export type AdminTenant = Readonly<{
  id: string;
  name: string;
  modules: readonly string[];
  usage: Readonly<{ events?: number; profiles?: number; monthlyLimit?: number }>;
}>;

export type Profile = Readonly<{
  id: string;
  anonymousId?: string;
  userId?: string;
  email?: string;
  firmographics?: Readonly<{ company?: string; industry?: string }>;
  intent?: Readonly<{ score?: number }>;
}>;

export type TenantEvent = Readonly<{
  type: string;
  anonymousId: string;
  event?: string;
  ts?: string;
}>;

export type PlannedState<T> = Readonly<{
  data: T;
  planned: boolean;
  error: string;
}>;

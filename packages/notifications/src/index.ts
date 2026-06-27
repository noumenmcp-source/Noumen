/** @example const channel: Channel = "email"; */
export type Channel = "in_app" | "email" | "slack" | "sms";

/** @example const notification: Notification = { template: "Hi {{name}}", data: { name: "Ada" }, channels: ["email"] }; */
export type Notification = Readonly<{ template: string; subjectTemplate?: string; data: Readonly<Record<string, unknown>>; channels: readonly Channel[] }>;

/** @example const prefs: Preferences = { allowed: ["email"] }; */
export type Preferences = Readonly<{ allowed: readonly Channel[] }>;

/** @example const check: ConsentCheck = (channel) => channel !== "sms"; */
export type ConsentCheck = (channel: Channel) => boolean | Promise<boolean>;

/** @example const sender: Sender = async () => undefined; */
export type Sender = (message: RenderedNotification) => Promise<void> | void;

/** @example const rendered = renderTemplate("Hi {{name}}", { name: "Ada" }); */
export type RenderedNotification = Readonly<{ subject?: string; body: string; channel: Channel }>;

/** @example const result: DeliveryResult = { channel: "email", status: "delivered" }; */
export type DeliveryResult = Readonly<{ channel: Channel; status: "delivered" | "skipped" | "failed"; reason?: string }>;

/** @example const rendered = renderTemplate("Hi {{name}}", { name: "Ada" }); */
export function renderTemplate(template: string, data: Readonly<Record<string, unknown>>): { body: string } {
  return { body: template.replace(/\{\{([^}]+)}}/g, (_, key: string) => stringify(data[key.trim()])) };
}

/** @example const channels = await selectChannels(notification, prefs, consent); */
export async function selectChannels(notification: Notification, prefs: Preferences, consentCheck: ConsentCheck): Promise<readonly Channel[]> {
  const allowed = new Set(prefs.allowed);
  const selected: Channel[] = [];
  for (const channel of notification.channels) {
    if (allowed.has(channel) && (channel !== "sms" || await consentCheck(channel))) selected.push(channel);
  }
  return selected;
}

/** @example const results = await dispatch(notification, prefs, senders, { consentCheck }); */
export async function dispatch(
  notification: Notification,
  prefs: Preferences,
  senders: Partial<Record<Channel, Sender>>,
  ctx: Readonly<{ consentCheck: ConsentCheck }>,
): Promise<readonly DeliveryResult[]> {
  const channels = await selectChannels(notification, prefs, ctx.consentCheck);
  return Promise.all(channels.map((channel) => deliver(channel, notification, senders[channel])));
}

async function deliver(channel: Channel, notification: Notification, sender?: Sender): Promise<DeliveryResult> {
  if (!sender) return { channel, status: "skipped", reason: "missing_sender" };
  try {
    await sender({ channel, subject: notification.subjectTemplate ? renderTemplate(notification.subjectTemplate, notification.data).body : undefined, body: renderTemplate(notification.template, notification.data).body });
    return { channel, status: "delivered" };
  } catch {
    return { channel, status: "failed" };
  }
}

function stringify(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

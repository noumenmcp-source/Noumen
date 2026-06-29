import type { DeliveryResult, MessengerAdapter } from "./adapters.js";

/** @example const tg = createTelegramMessenger({ token: process.env.TELEGRAM_BOT_TOKEN }); */
export type TelegramOptions = Readonly<{ token?: string; fetchImpl?: typeof fetch }>;

type TelegramSendResponse = Readonly<{ ok: boolean; result?: { message_id: number }; description?: string }>;

/**
 * Real {@link MessengerAdapter} backed by the Telegram Bot API. `to` is the
 * chat id. The token comes from `opts.token` or `TELEGRAM_BOT_TOKEN`; absence
 * throws at construction so misconfiguration fails fast rather than at send.
 */
export function createTelegramMessenger(opts?: TelegramOptions): MessengerAdapter {
  const token = opts?.token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("telegram: missing bot token");
  const fetchImpl = opts?.fetchImpl ?? fetch;

  return {
    async send(to: string, content: string): Promise<DeliveryResult> {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: to, text: content }),
      });
      if (!response.ok) throw new Error(`telegram: send failed (${response.status})`);

      const body = (await response.json()) as TelegramSendResponse;
      if (!body.ok || !body.result) {
        throw new Error(`telegram: send rejected (${body.description ?? "unknown"})`);
      }
      return { id: String(body.result.message_id) };
    },
  };
}

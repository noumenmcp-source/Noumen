import type { FastifyInstance } from "fastify";
import { authenticate, roleSatisfies, type TokenStore } from "../auth.js";
import type { TenantStore } from "../tenant.js";

/**
 * Управленческий финансовый учёт тенанта («Финансовый учёт» в консоли).
 * Помесячная выручка/комиссия маркетплейса/выплата + товарная аналитика по SKU.
 * Источник — воронка продаж (напр. Ozon); закупочная себестоимость и банковский
 * ДДС приходят из внешнего учёта (1С) и в этот срез пока не входят — см. meta.note.
 */
export interface FinanceMeta {
  readonly source: string;
  readonly status_filter: string;
  readonly range: string;
  readonly note: string;
}
export interface FinanceMonth {
  readonly key: string;
  readonly label: string;
  readonly revenue: number; // выручка gross, ₽
  readonly commission: number; // комиссия маркетплейса (отрицательная), ₽
  readonly payout: number; // выплата тенанту (выручка после маркетплейса), ₽
  readonly orders: number;
  readonly units: number;
}
export interface FinanceOffer {
  readonly name: string;
  readonly units: number;
  readonly revenue: number;
  readonly commission: number;
  readonly payout: number;
}
export interface FinanceSummary {
  readonly meta: FinanceMeta | null;
  readonly months: readonly FinanceMonth[];
  readonly offers: readonly FinanceOffer[];
}

/** Источник финсводки тенанта. Прод-реализация читает агрегат из хранилища;
 * тесты инъектят фейк. Возвращает null, если для тенанта данных нет. */
export interface FinanceStore {
  readSummary(tenantId: string): Promise<FinanceSummary | null>;
}

export interface FinanceDeps {
  readonly tenantStore: TenantStore;
  readonly tokenStore: TokenStore;
  readonly finance: FinanceStore;
}

const EMPTY: FinanceSummary = { meta: null, months: [], offers: [] };

/**
 * Финансовый учёт, привязанный к API: отдаёт помесячную сводку и товарную
 * аналитику тенанта. Read-only, без побочных эффектов. Пустой набор — не ошибка
 * (детерминированная пустая сводка, 200), чтобы новый тенант не падал в 404.
 *
 * Доступ: auth + own-tenant + analyst-tier. Отказ источника (IO) → 502 без
 * утечки внутренностей.
 *
 * @example GET /v1/tenants/t_1/finance/summary
 */
export function registerFinance(app: FastifyInstance, deps: FinanceDeps): void {
  app.get("/v1/tenants/:tenantId/finance/summary", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const principal = await authenticate(req, deps.tokenStore);
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    if (principal.tenantId !== tenantId || !roleSatisfies(principal.role, "analyst")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const tenant = await deps.tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });

    let summary: FinanceSummary | null;
    try {
      summary = await deps.finance.readSummary(tenantId);
    } catch {
      return reply.code(502).send({ error: "finance_failed" });
    }

    return reply.send({ ok: true, tenantId, summary: summary ?? EMPTY });
  });
}

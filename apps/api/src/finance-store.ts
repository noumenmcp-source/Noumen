import type { FinanceStore, FinanceSummary } from "./routes/finance.js";
import { OLYMP_FINANCE } from "./data/finance-olymp.js";

/**
 * In-memory финсводки по тенантам. Прототип: заранее посчитанные агрегаты
 * (ETL продаж → сводка) отдаются по id тенанта. Прод-версия заменит это чтением
 * из БД/склада с инкрементальным ETL. Неизвестный тенант → null (роут вернёт
 * пустую сводку 200).
 */
export class StaticFinanceStore implements FinanceStore {
  constructor(private readonly byTenant: Readonly<Record<string, FinanceSummary>>) {}

  async readSummary(tenantId: string): Promise<FinanceSummary | null> {
    return this.byTenant[tenantId] ?? null;
  }
}

/**
 * Стор по умолчанию для хоста: сводка «Олимп бизнес» (реальные продажи Ozon)
 * выдаётся тенанту из env FINANCE_OLYMP_TENANT. Если переменная не задана —
 * данные привязаны к id "olymp" (прототип). Так реальный агрегат не утекает
 * другим тенантам, а маппинг остаётся явным.
 */
export function defaultFinanceStore(): StaticFinanceStore {
  const olympTenant = process.env.FINANCE_OLYMP_TENANT ?? "olymp";
  return new StaticFinanceStore({ [olympTenant]: OLYMP_FINANCE });
}

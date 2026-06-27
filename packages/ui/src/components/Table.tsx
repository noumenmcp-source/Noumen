import type { ReactNode } from "react";
import { cx } from "../utils.js";

export type TableColumn<TData extends object> = {
  readonly key: string;
  readonly header: ReactNode;
  readonly render: (row: TData, rowIndex: number) => ReactNode;
  readonly className?: string;
  readonly headerClassName?: string;
};

export type TableProps<TData extends object> = {
  readonly columns: readonly TableColumn<TData>[];
  readonly rows: readonly TData[];
  readonly caption?: string;
  readonly className?: string;
  readonly emptyMessage?: string;
  readonly getRowKey?: (row: TData, rowIndex: number) => string;
};

export function Table<TData extends object>({
  caption,
  className,
  columns,
  emptyMessage = "No rows",
  getRowKey,
  rows,
}: TableProps<TData>) {
  return (
    <div className={cx("overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm", className)}>
      <table className="w-full border-collapse text-left text-sm text-slate-700">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
          <tr>
            {columns.map((column) => (
              <th className={cx("border-b border-slate-200 px-3 py-2", column.headerClassName)} key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, rowIndex) => (
              <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50" key={getRowKey?.(row, rowIndex) ?? rowIndex}>
                {columns.map((column) => (
                  <td className={cx("px-3 py-2 align-middle", column.className)} key={column.key}>
                    {column.render(row, rowIndex)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-3 py-8 text-center text-sm text-slate-500" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

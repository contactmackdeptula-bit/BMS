import { Fragment, type ReactNode } from "react";
import { Button, Pill, type Tone } from "./basics";

// ---------- DataTable ----------
export type Column<Row> = {
  key: string;
  label: string;
  align?: "left" | "right";
  nowrap?: boolean;
  render?: (row: Row) => ReactNode;
};

export function DataTable<Row extends Record<string, unknown>>({
  caption,
  columns,
  rows,
  rowKey,
  groupBy,
  groupLabel,
  groupClassName,
  emptyMessage = "Nothing here yet.",
  footer,
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  groupBy?: (row: Row) => string;
  groupLabel?: (group: string) => ReactNode;
  groupClassName?: (group: string) => string;
  emptyMessage?: ReactNode;
  footer?: ReactNode;
}) {
  const cell = (row: Row, c: Column<Row>) => (c.render ? c.render(row) : (row[c.key] as ReactNode));
  const cls = (c: Column<Row>) => [c.align === "right" ? "align-right" : "", c.nowrap ? "nowrap" : ""].join(" ").trim() || undefined;

  const groups: [string, Row[]][] = [];
  if (groupBy) {
    for (const r of rows) {
      const g = groupBy(r);
      const existing = groups.find(([k]) => k === g);
      if (existing) existing[1].push(r);
      else groups.push([g, [r]]);
    }
  }

  const renderRows = (rs: Row[]) =>
    rs.map((r) => (
      <tr key={rowKey(r)}>
        {columns.map((c) => (
          <td key={c.key} className={cls(c)}>
            {cell(r, c)}
          </td>
        ))}
      </tr>
    ));

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cls(c)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {rows.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={columns.length} className="table-empty">
                  {emptyMessage}
                </td>
              </tr>
            </tbody>
          ) : groupBy ? (
            groups.map(([g, rs]) => (
              <tbody key={g}>
                <tr>
                  <th scope="rowgroup" colSpan={columns.length} className={groupClassName?.(g)}>
                    {groupLabel ? groupLabel(g) : g}
                  </th>
                </tr>
                {renderRows(rs)}
              </tbody>
            ))
          ) : (
            <tbody>{renderRows(rows)}</tbody>
          )}
        </table>
      </div>
      {footer && <div className="table-footer">{footer}</div>}
    </>
  );
}

// ---------- FilterChips ----------
export function FilterChips({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string; count?: number }[];
  selected: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="chip"
          aria-pressed={selected === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count != null && ` ${o.count}`}
        </button>
      ))}
    </div>
  );
}

// ---------- AttentionRow ----------
export function AttentionRow({
  pill,
  title,
  detail,
  action,
}: {
  pill: { tone: Tone; label: string };
  title: string;
  detail?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div className="attention-row">
      <Pill tone={pill.tone} label={pill.label} />
      <div className="attention-text">
        <span className="attention-title">{title}</span>
        {detail && <span className="attention-detail">{detail}</span>}
      </div>
      {action ? (
        <Button size="sm" href={action.href} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

export function AttentionList({ children }: { children: ReactNode }) {
  return <div className="attention-list">{children}</div>;
}

// ---------- MonthStrip ----------
export function MonthStrip({
  months,
  selected,
  onSelect,
}: {
  months: { key: string; label: string; fullLabel: string; count: number; tone: Tone }[];
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  return (
    <div className="month-strip" role="group" aria-label="Items falling due each month">
      {months.map((m) => (
        <Fragment key={m.key}>
          <button
            type="button"
            className="month"
            aria-pressed={selected === m.key}
            aria-label={`${m.fullLabel}: ${m.count} ${m.count === 1 ? "item" : "items"} due`}
            onClick={() => onSelect?.(selected === m.key ? null : m.key)}
          >
            <span className="month-label">{m.label}</span>
            <span className={`month-count text-${m.tone}`}>{m.count}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}

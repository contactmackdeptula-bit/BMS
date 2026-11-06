import type { ReactNode } from "react";
import { Link } from "react-router";

export type Tone = "danger" | "warn" | "info" | "ok" | "neutral";

// ---------- Button ----------
type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  loading?: boolean;
  disabled?: boolean;
  href?: string;
  type?: "button" | "submit";
  onClick?: () => void;
  children: ReactNode;
  "aria-label"?: string;
};

export function Button({ variant = "secondary", size = "md", loading, disabled, href, type = "button", onClick, children, ...rest }: ButtonProps) {
  const cls = `btn btn-${variant}${size === "sm" ? " btn-sm" : ""}`;
  const content = loading ? (
    <>
      <span className="btn-spinner" aria-hidden="true" />
      {/* Label stays for width and for screen readers. */}
      <span style={{ position: "absolute", visibility: "hidden" }}>{children}</span>
      <span className="visually-hidden">{children}</span>
    </>
  ) : (
    children
  );
  if (href) {
    const internal = href.startsWith("/");
    return internal ? (
      <Link className={cls} to={href} aria-disabled={disabled || undefined} aria-label={rest["aria-label"]}>
        {children}
      </Link>
    ) : (
      <a className={cls} href={href} aria-disabled={disabled || undefined} aria-label={rest["aria-label"]}>
        {children}
      </a>
    );
  }
  return (
    <button
      className={cls}
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={rest["aria-label"]}
      style={loading ? { position: "relative" } : undefined}
    >
      {content}
    </button>
  );
}

// ---------- Pill ----------
export function Pill({ tone = "neutral", label }: { tone?: Tone; label: string }) {
  return <span className={`pill tone-${tone}`}>{label}</span>;
}

// ---------- Card ----------
export function Card({
  title,
  link,
  caption,
  className = "",
  children,
  headingId,
}: {
  title?: string;
  link?: { label: string; href: string };
  caption?: string;
  className?: string;
  children?: ReactNode;
  headingId?: string;
}) {
  return (
    <section className={`card ${className}`} aria-labelledby={title ? headingId : undefined}>
      {(title || link) && (
        <div className="card-head">
          <div>
            {title && (
              <h2 className="card-title" id={headingId}>
                {title}
              </h2>
            )}
            {caption && <div className="card-caption">{caption}</div>}
          </div>
          {link && (
            <Link className="card-link" to={link.href}>
              {link.label}
            </Link>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- PageHeader ----------
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-title-block">
        <h1 className="page-title">{title}</h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

// ---------- StatTile ----------
export function StatTile({
  label,
  value,
  tone = "default",
  caption,
  href,
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warn";
  caption?: string;
  href?: string;
}) {
  // A zero is shown in ink, never in the warning colour (UI-HANDOFF §13).
  const toneClass = tone !== "default" && value !== "0" ? ` tone-text-${tone}` : "";
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className={`stat-value${toneClass}`}>{value}</span>
      {caption && <span className="stat-caption">{caption}</span>}
    </>
  );
  return href ? (
    <Link className="stat" to={href}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

// ---------- ProgressBar ----------
export function ProgressBar({
  value,
  tone = "ok",
  label,
  rightLabel,
  large,
}: {
  value: number;
  tone?: Tone;
  label: string;
  rightLabel?: string;
  large?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress">
      <div className="progress-labels">
        <span>{label}</span>
        {rightLabel && <span className="right">{rightLabel}</span>}
      </div>
      <div
        className={`progress-track${large ? " lg" : ""}`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={rightLabel ? `${label}: ${rightLabel}` : label}
      >
        <div className={`progress-fill fill-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------- Panels ----------
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel tone-danger" role="alert">
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "ok", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`panel tone-${tone}`} role="status">
      <span>{children}</span>
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

// Side sheet (UI-HANDOFF §13, §14): slides in from the right at 440 px with a
// scrim; Escape closes; focus moves to the first field, is trapped while open,
// and returns to the opener on close.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SideSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  ready = true,
}: {
  open: boolean;
  /** Set false while the sheet's form is loading; focus moves to the first field once it is true. */
  ready?: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const el = panel.current!;
    // First form field if there is one, otherwise the first control (the close button).
    const firstField = el.querySelector<HTMLElement>("input:not([type=hidden]):not(.visually-hidden), select, textarea");
    (firstField ?? el.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  // Content that loads after opening: move focus to its first field once it arrives.
  useEffect(() => {
    if (!open || !ready) return;
    const el = panel.current;
    if (!el || !el.contains(document.activeElement) || !(document.activeElement as HTMLElement).classList.contains("sheet-close")) return;
    el.querySelector<HTMLElement>("input:not([type=hidden]):not(.visually-hidden), select, textarea")?.focus();
  }, [open, ready]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <div className="sheet-head">
          <div>
            <h2 className="sheet-title" id={titleId}>
              {title}
            </h2>
            {subtitle && <div className="sheet-subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

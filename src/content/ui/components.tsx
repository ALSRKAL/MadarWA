import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, Check, ChevronDown, Copy, Loader2, Settings, X } from "lucide-react";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focused element, looking through open shadow roots (the launcher lives in one). */
function deepActiveElement(): HTMLElement | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
}

/**
 * Modal focus contract: focus moves into the dialog when it opens, Tab and
 * Shift+Tab cycle inside it, and focus returns to the opener when it closes.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const opener = deepActiveElement();
    const initial = node.querySelector<HTMLElement>("[data-autofocus]") ?? node;
    initial.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const root = node.getRootNode() as Document | ShadowRoot;
      const current = root.activeElement;
      if (event.shiftKey && (current === first || current === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost" | "success";
type ButtonSize = "sm" | "md" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "mw-btn-primary",
  secondary: "mw-btn-secondary",
  ghost: "mw-btn-ghost",
  danger: "mw-btn-danger",
  dangerGhost: "mw-btn-danger-ghost",
  success: "mw-btn-success",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "mw-btn-sm",
  md: "",
  icon: "!px-0 !w-8",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn("mw-btn", BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn("mw-icon-btn", className)} {...rest}>
      {children}
    </button>
  );
}

/** Surface with the default 12px inset; pass a p-* class (e.g. p-0 for row lists) to override it. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  const customPadding = /(^|\s)p-\d/.test(className ?? "");
  return <div className={cn("mw-card", !customPadding && "p-3", className)}>{children}</div>;
}

export function SectionTitle({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {icon ? (
          <span className="mt-0.5 shrink-0 text-wa-muted" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-mw-base font-semibold leading-5 text-wa-text">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-mw-xs leading-5 text-wa-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Small muted label that names a group of rows inside a card. */
export function GroupLabel({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
      {icon ? (
        <span className="shrink-0 text-wa-muted" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h3 className="min-w-0 flex-1 truncate text-mw-xs font-semibold text-wa-muted">{children}</h3>
      {action}
    </div>
  );
}

/**
 * Setting row with a switch. The whole row is a mouse target; the switch is
 * the single keyboard/AT control, named by the label and described by the hint.
 * The label is deliberately not a <label>: a <label for> inside a clickable
 * row fires twice (row click + synthetic control click) and cancels itself.
 */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  warning,
  action,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  warning?: boolean;
  action?: ReactNode;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-3 py-2.5",
        disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-wa-hover",
      )}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span id={labelId} className="text-mw-sm font-medium leading-5 text-wa-text">
            {label}
          </span>
          {warning ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-wa-warning" aria-hidden="true" /> : null}
        </div>
        {hint ? (
          <p id={hintId} className="mt-0.5 text-mw-xs leading-5 text-wa-muted">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {action ? (
          <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
            {action}
          </span>
        ) : null}
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onChange(!checked);
          }}
          className="mw-toggle mt-0.5"
        >
          <span />
        </button>
      </div>
    </div>
  );
}

export function ConfigureButton({
  open,
  onClick,
  label,
  title,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={title ?? label}
      className={cn("mw-configure", open && "is-open")}
    >
      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{label}</span>
      <ChevronDown className="h-3.5 w-3.5 transition-transform" aria-hidden="true" />
    </button>
  );
}

export function Disclosure({ open, children }: { open: boolean; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="mw-disclosure is-open">
      <div className="mw-disclosure-inner">
        <div className="mw-disclosure-content">{children}</div>
      </div>
    </div>
  );
}

export interface StepItem {
  id: number;
  label: string;
}

export function Stepper({
  steps,
  active,
  onSelect,
  ariaLabel,
}: {
  steps: StepItem[];
  active: number;
  onSelect?: (id: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="mw-stepper" role="group" aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const state = step.id === active ? "active" : step.id < active ? "done" : "idle";
        return (
          <div key={step.id} className="mw-step-group">
            {index > 0 ? <span className="mw-step-line" aria-hidden="true" /> : null}
            <button
              type="button"
              onClick={() => onSelect?.(step.id)}
              data-state={state}
              aria-current={state === "active" ? "step" : undefined}
              className="mw-step"
            >
              <span className="mw-step-index" aria-hidden="true">
                {state === "done" ? <Check className="h-3 w-3" /> : step.id}
              </span>
              <span className="mw-step-label">{step.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="mw-chips" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className="mw-chip"
          data-active={value === option.id ? "1" : "0"}
        >
          {option.label}
          {typeof option.count === "number" ? <span className="mw-chip-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Inputs inside a Field pick up its id, description and error state automatically. */
function useFieldControl(id: string | undefined, describedBy: string | undefined) {
  const field = useContext(FieldContext);
  return {
    id: id ?? field?.id,
    "aria-describedby": describedBy ?? field?.describedBy,
    "aria-invalid": field?.invalid ? true : undefined,
  };
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);
  return (
    <FieldContext.Provider value={{ id, describedBy: hasMessage ? messageId : undefined, invalid: Boolean(error) }}>
      <div className={cn("space-y-1", className)}>
        {label ? (
          <label htmlFor={id} className="block text-mw-xs font-semibold text-wa-muted">
            {label}
          </label>
        ) : null}
        {children}
        {error ? (
          <p id={messageId} role="alert" className="text-mw-xs font-medium leading-5 text-wa-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={messageId} className="text-mw-xs leading-5 text-wa-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export function TextInput({ className, id, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const control = useFieldControl(id, rest["aria-describedby"]);
  return <input className={cn("mw-input", className)} {...rest} {...control} />;
}

export function TextArea({ className, id, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const control = useFieldControl(id, rest["aria-describedby"]);
  return <textarea className={cn("mw-input", className)} {...rest} {...control} />;
}

export function Select({ className, children, id, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const control = useFieldControl(id, rest["aria-describedby"]);
  return (
    <select className={cn("mw-input appearance-none pe-7", className)} {...rest} {...control}>
      {children}
    </select>
  );
}

/**
 * Number input that lets people type freely and only clamps when they leave
 * the field or press Enter (clamping on every keystroke turns "1500" into 50).
 */
export function NumberInput({
  value,
  min,
  max,
  onCommit,
  className,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const control = useFieldControl(undefined, undefined);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) && draft.trim() !== "" ? Math.min(max, Math.max(min, Math.round(parsed))) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className={cn("mw-input", className)}
      {...control}
    />
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "brand";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "mw-badge-neutral",
  success: "mw-badge-success",
  warning: "mw-badge-warning",
  danger: "mw-badge-danger",
  brand: "mw-badge-brand",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("mw-badge", BADGE_TONES[tone], className)}>{children}</span>;
}

export function Progress({
  value,
  max,
  className,
  label,
}: {
  value: number;
  max: number;
  className?: string;
  label?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={cn("mw-progress", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      {icon ? (
        <div className="mb-2 text-wa-muted" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="text-mw-sm font-medium text-wa-text">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-mw-xs leading-5 text-wa-muted">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: BadgeTone }) {
  const color =
    tone === "success" ? "text-wa-brand" : tone === "danger" ? "text-wa-danger" : tone === "warning" ? "text-wa-warning" : "text-wa-text";
  return (
    <div className="mw-metric">
      <span className="mw-metric-label">{label}</span>
      <span className={cn("mw-metric-value", color)}>{value}</span>
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: "border-wa-line bg-wa-surface text-wa-text",
    warning: "border-wa-warning/30 bg-wa-warning/10 text-wa-warning",
    danger: "border-wa-danger/30 bg-wa-danger/10 text-wa-danger",
    success: "border-wa-brand/30 bg-wa-brand/10 text-wa-brand",
  }[tone];
  return (
    <div className={cn("rounded-md border px-2.5 py-2 text-mw-xs leading-5", styles)} role={tone === "danger" ? "alert" : undefined}>
      {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
      <div className="opacity-90">{children}</div>
    </div>
  );
}

export function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      return;
    } catch {
      // Clipboard API can be blocked; fall back to a temporary textarea.
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-mw-xs font-medium text-wa-muted transition-colors hover:bg-wa-hover hover:text-wa-text"
      aria-live="polite"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-wa-brand" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? copiedLabel : label}
    </button>
  );
}

/**
 * Dialog on top of the drawer. Escape closes only the dialog (the drawer
 * beneath stays open with its state), focus is held inside, and the opener
 * gets focus back on close.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(ref, open);
  if (!open) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2147483200] flex items-center justify-center p-4" style={{ pointerEvents: "auto" }}>
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="mw-card-strong relative z-10 w-full max-w-md p-3.5 shadow-2xl outline-none"
      >
        <div className="mb-2.5 flex items-center justify-between gap-3 border-b border-wa-line pb-2">
          <h3 id={titleId} className="text-mw-base font-semibold">
            {title}
          </h3>
          <IconButton label={closeLabel} onClick={onClose} className="h-7 w-7">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="mw-scroll max-h-[60vh] overflow-y-auto">{children}</div>
        {footer ? <div className="mt-3 flex justify-end gap-2 border-t border-wa-line pt-2.5">{footer}</div> : null}
      </div>
    </div>
  );
}

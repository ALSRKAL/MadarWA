import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700 shadow-[0_10px_24px_-12px_rgba(5,150,105,.9)]",
  secondary: "mw-card text-[color:var(--mw-text)] hover:bg-[color:var(--mw-hover)]",
  ghost: "bg-transparent text-[color:var(--mw-muted)] hover:bg-[color:var(--mw-hover)] hover:text-[color:var(--mw-text)]",
  danger: "bg-rose-600/90 text-white hover:bg-rose-500 active:bg-rose-700",
  success: "bg-emerald-600/90 text-white hover:bg-emerald-500",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-xl gap-2",
  icon: "h-9 w-9 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
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
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-xl text-[color:var(--mw-muted)] transition-colors hover:bg-[color:var(--mw-hover)] hover:text-[color:var(--mw-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mw-card p-4", className)}>{children}</div>;
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
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 text-brand-400 ring-1 ring-brand-500/20">
            {icon}
          </span>
        ) : null}
        <div>
          <h2 className="text-[15px] font-bold leading-6 text-[color:var(--mw-text)]">{title}</h2>
          {subtitle ? <p className="mw-muted mt-0.5 text-xs leading-5">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  warning,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  warning?: boolean;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl px-1 py-2.5 transition-colors",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[color:var(--mw-hover)]",
      )}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-[13px] font-semibold leading-5 text-[color:var(--mw-text)]">
            {label}
          </label>
          {warning ? <span className="text-[10px] font-bold text-amber-400">!</span> : null}
        </div>
        {hint ? <p className="mw-muted mt-0.5 text-[11px] leading-[1.6]">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onChange(!checked);
        }}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70",
          checked ? "bg-brand-500" : "bg-slate-500/45",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "start-5" : "start-0.5",
          )}
        />
      </button>
    </div>
  );
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
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-[color:var(--mw-text)]">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[11px] font-medium text-rose-400">{error}</p>
      ) : hint ? (
        <p className="mw-muted text-[11px] leading-[1.6]">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("mw-input", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("mw-input", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("mw-input appearance-none pe-8", className)} {...rest}>
      {children}
    </select>
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "brand";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-500/15 text-slate-300 ring-slate-400/20",
  success: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25",
  warning: "bg-amber-500/15 text-amber-300 ring-amber-400/25",
  danger: "bg-rose-500/15 text-rose-300 ring-rose-400/25",
  brand: "bg-brand-500/15 text-brand-300 ring-brand-400/25",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Progress({
  value,
  max,
  striped = false,
  className,
}: {
  value: number;
  max: number;
  striped?: boolean;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-500/20", className)}>
      <div
        className={cn("h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-400 transition-all duration-500", striped && "mw-progress-stripe")}
        style={{ width: `${percent}%` }}
      />
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--mw-border)] px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-[color:var(--mw-muted)]">{icon}</div> : null}
      <p className="text-[13px] font-semibold text-[color:var(--mw-text)]">{title}</p>
      {body ? <p className="mw-muted mt-1 max-w-sm text-[11px] leading-6">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: BadgeTone }) {
  const color =
    tone === "success" ? "text-emerald-300" : tone === "danger" ? "text-rose-300" : tone === "warning" ? "text-amber-300" : "text-[color:var(--mw-text)]";
  return (
    <div className="mw-card flex flex-col gap-0.5 px-3 py-2.5">
      <span className="mw-muted text-[10px] font-medium">{label}</span>
      <span className={cn("text-base font-bold leading-6", color)}>{value}</span>
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
    info: "border-sky-400/25 bg-sky-500/10 text-sky-200",
    warning: "border-amber-400/25 bg-amber-500/10 text-amber-200",
    danger: "border-rose-400/25 bg-rose-500/10 text-rose-200",
    success: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
  }[tone];
  return (
    <div className={cn("rounded-xl border px-3 py-2.5 text-[11px] leading-6", styles)}>
      {title ? <p className="mb-0.5 font-bold">{title}</p> : null}
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
      className="mw-muted inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold transition-colors hover:bg-[color:var(--mw-hover)] hover:text-[color:var(--mw-text)]"
      title={copied ? copiedLabel : label}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? copiedLabel : label}
    </button>
  );
}

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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2147483200] flex items-center justify-center p-4" style={{ pointerEvents: "auto" }}>
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="mw-card-strong relative z-10 w-full max-w-md p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">{title}</h3>
          <IconButton label={closeLabel} onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="max-h-[60vh] overflow-y-auto mw-scroll">{children}</div>
        {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

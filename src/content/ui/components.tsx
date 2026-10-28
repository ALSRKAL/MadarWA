import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, Check, Copy, Loader2, X } from "lucide-react";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
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
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
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

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mw-card", className)}>{children}</div>;
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
        {icon ? <span className="mt-0.5 shrink-0 text-wa-muted">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold leading-5 text-wa-text">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[10.5px] leading-4 text-wa-muted">{subtitle}</p> : null}
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
        "flex items-start justify-between gap-4 px-3 py-2.5",
        disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-wa-hover",
      )}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="cursor-pointer text-[12px] font-medium leading-5 text-wa-text">
            {label}
          </label>
          {warning ? <AlertTriangle className="h-3 w-3 text-wa-warning" /> : null}
        </div>
        {hint ? <p className="mt-0.5 text-[10.5px] leading-[1.55] text-wa-muted">{hint}</p> : null}
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
        className="mw-toggle mt-0.5"
      >
        <span />
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
    <div className={cn("space-y-1", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-[10.5px] font-semibold text-wa-muted">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[10px] font-medium text-wa-danger">{error}</p>
      ) : hint ? (
        <p className="text-[10px] leading-[1.5] text-wa-muted">{hint}</p>
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
    <select className={cn("mw-input appearance-none pe-7", className)} {...rest}>
      {children}
    </select>
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
}: {
  value: number;
  max: number;
  striped?: boolean;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cn("mw-progress", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
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
      {icon ? <div className="mb-2 text-wa-muted">{icon}</div> : null}
      <p className="text-[12px] font-medium text-wa-text">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-[10.5px] leading-5 text-wa-muted">{body}</p> : null}
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
    <div className={cn("rounded-md border px-2.5 py-2 text-[10.5px] leading-5", styles)}>
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
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-wa-muted transition-colors hover:bg-wa-hover hover:text-wa-text"
      title={copied ? copiedLabel : label}
    >
      {copied ? <Check className="h-3 w-3 text-wa-brand" /> : <Copy className="h-3 w-3" />}
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
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="mw-card-strong relative z-10 w-full max-w-md p-3.5 shadow-2xl">
        <div className="mb-2.5 flex items-center justify-between gap-3 border-b border-wa-line pb-2">
          <h3 className="text-[12.5px] font-semibold">{title}</h3>
          <IconButton label={closeLabel} onClick={onClose} className="h-7 w-7">
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="mw-scroll max-h-[60vh] overflow-y-auto">{children}</div>
        {footer ? <div className="mt-3 flex justify-end gap-2 border-t border-wa-line pt-2.5">{footer}</div> : null}
      </div>
    </div>
  );
}

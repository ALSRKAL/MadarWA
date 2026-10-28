import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, Trash2, X } from "lucide-react";
import { useAppStore, type ToastItem } from "../store";

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useAppStore((state) => state.dismissToast);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), toast.kind === "deleted" ? 9000 : 5200);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id, toast.kind]);

  const icon =
    toast.kind === "success" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    ) : toast.kind === "error" ? (
      <AlertTriangle className="h-4 w-4 text-rose-400" />
    ) : toast.kind === "deleted" ? (
      <Trash2 className="h-4 w-4 text-rose-400" />
    ) : (
      <Info className="h-4 w-4 text-sky-400" />
    );

  return (
    <div
      className={`mw-toast animate-madar-toast-in flex w-[min(420px,calc(100vw-32px))] items-start gap-2.5 rounded-2xl px-3.5 py-3 ${
        toast.kind === "deleted" ? "mw-toast-deleted" : ""
      }`}
      role="status"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold leading-5">{toast.title}</p>
        {toast.body ? <p className="mw-muted mt-0.5 line-clamp-3 text-[11px] leading-5">{toast.body}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="mw-muted -me-1 shrink-0 rounded-lg p-1 transition-colors hover:bg-[color:var(--mw-hover)] hover:text-[color:var(--mw-text)]"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed inset-x-0 top-3 z-[2147483500] flex flex-col items-center gap-2 px-4"
      style={{ pointerEvents: "none" }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

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
      <CheckCircle2 className="h-3.5 w-3.5 text-wa-brand" />
    ) : toast.kind === "error" ? (
      <AlertTriangle className="h-3.5 w-3.5 text-wa-danger" />
    ) : toast.kind === "deleted" ? (
      <Trash2 className="h-3.5 w-3.5 text-wa-danger" />
    ) : (
      <Info className="h-3.5 w-3.5 text-wa-muted" />
    );

  return (
    <div
      className={`mw-toast flex w-[min(390px,calc(100vw-32px))] items-start gap-2 px-3 py-2.5 ${
        toast.kind === "deleted" ? "mw-toast-deleted" : ""
      }`}
      role="status"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold leading-4">{toast.title}</p>
        {toast.body ? <p className="mt-0.5 line-clamp-3 text-[10px] leading-4 text-wa-muted">{toast.body}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="-me-1 shrink-0 rounded p-0.5 text-wa-muted hover:bg-wa-hover hover:text-wa-text"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed inset-x-0 top-2 z-[2147483500] flex flex-col items-center gap-1.5 px-4" style={{ pointerEvents: "none" }}>
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

import { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Info, Trash2, X } from "lucide-react";
import { useAppStore, useT, type ToastItem } from "../store";

const TOAST_MS = { deleted: 9000, action: 8000, default: 5200, minAfterHover: 1200 } as const;

function toastDuration(toast: ToastItem): number {
  if (toast.action) return TOAST_MS.action;
  return toast.kind === "deleted" ? TOAST_MS.deleted : TOAST_MS.default;
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const t = useT();
  const dismiss = useAppStore((state) => state.dismissToast);
  const timer = useRef(0);
  const remaining = useRef(toastDuration(toast));
  const startedAt = useRef(0);
  const paused = useRef(false);

  // Hover or focus pauses the countdown so an Undo is never pulled away mid-reach.
  const start = useCallback(() => {
    paused.current = false;
    startedAt.current = Date.now();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => dismiss(toast.id), Math.max(TOAST_MS.minAfterHover, remaining.current));
  }, [dismiss, toast.id]);

  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    window.clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  };

  useEffect(() => {
    start();
    return () => window.clearTimeout(timer.current);
  }, [start]);

  const icon =
    toast.kind === "success" ? (
      <CheckCircle2 className="h-4 w-4 text-wa-success" aria-hidden="true" />
    ) : toast.kind === "error" ? (
      <AlertTriangle className="h-4 w-4 text-wa-danger" aria-hidden="true" />
    ) : toast.kind === "deleted" ? (
      <Trash2 className="h-4 w-4 text-wa-danger" aria-hidden="true" />
    ) : (
      <Info className="h-4 w-4 text-wa-muted" aria-hidden="true" />
    );

  return (
    <div
      className="mw-toast flex w-[min(400px,calc(100vw-32px))] items-start gap-2.5 px-3.5 py-3"
      role={toast.kind === "error" ? "alert" : "status"}
      onPointerEnter={pause}
      onPointerLeave={start}
      onFocus={pause}
      onBlur={start}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-mw-sm font-semibold leading-5">{toast.title}</p>
        {toast.body ? <p className="mt-0.5 line-clamp-3 text-mw-xs leading-5 text-wa-muted">{toast.body}</p> : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            dismiss(toast.id);
          }}
          className="mw-btn mw-btn-secondary mw-btn-sm shrink-0"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="mw-icon-btn -me-1 h-7 w-7 shrink-0"
        aria-label={t("common.dismiss")}
        title={t("common.dismiss")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts);
  const panelOpen = useAppStore((state) => state.panelOpen);
  if (toasts.length === 0) return null;
  // With the panel open, feedback stays inside the panel's column and away
  // from its header and connection banner; otherwise it sits at the top.
  const placement = panelOpen
    ? "bottom-4 end-0 w-[min(660px,100vw)] flex-col-reverse"
    : "inset-x-0 top-2 flex-col";
  return (
    <div
      className={`fixed z-[2147483500] flex items-center gap-1.5 px-4 ${placement}`}
      style={{ pointerEvents: "none" }}
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

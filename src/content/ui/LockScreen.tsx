import { useEffect, useState } from "react";
import { ArrowRight, Delete, Loader2, LockKeyhole } from "lucide-react";
import { verifyPin } from "../../shared/utils/pin";
import { contentController } from "../controller";
import { useAppStore, useT } from "../store";

function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <ellipse cx="12" cy="12" rx="9.2" ry="4.1" stroke="currentColor" strokeWidth="1.75" transform="rotate(-28 12 12)" />
      <circle cx="12" cy="12" r="2.8" fill="currentColor" />
      <circle cx="19.2" cy="7.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function LockScreen() {
  const t = useT();
  const settings = useAppStore((state) => state.settings);
  const theme = useAppStore((state) => state.theme);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async () => {
    if (busy || pin.length < 4) return;
    setBusy(true);
    setError("");
    try {
      const valid = await verifyPin(pin, { hash: settings.pin.hash, salt: settings.pin.salt });
      if (valid) {
        setPin("");
        contentController.unlock();
      } else {
        setError(t("privacy.wrongPin"));
        setShake((value) => value + 1);
        setPin("");
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        setPin((current) => (current.length >= 8 ? current : current + event.key));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        setPin((current) => current.slice(0, -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div
      className="mw-app fixed inset-0 z-[2147483600] flex items-center justify-center px-4"
      data-madarwa-theme={settings.theme === "auto" ? theme : settings.theme}
      dir={settings.language === "ar" ? "rtl" : "ltr"}
      lang={settings.language}
      style={{ pointerEvents: "auto" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("privacy.unlockTitle")}
    >
      <div className="w-full max-w-[320px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-wa-surface text-wa-brand">
            <OrbitMark className="h-6 w-6" />
          </div>
          <h1 className="mt-3 text-[16px] font-semibold leading-6">{t("privacy.unlockTitle")}</h1>
          <p className="mt-1 text-[10.5px] text-wa-muted">{t("privacy.unlockHint")}</p>
        </div>

        <div key={shake} className={shake > 0 ? "mw-shake" : undefined}>
          <div className="mb-4 flex items-center justify-center gap-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={index} className="mw-pin-dot" data-filled={index < pin.length} />
            ))}
          </div>

          {error ? (
            <p className="mb-3 rounded-md border border-wa-danger/25 bg-wa-danger/10 px-2.5 py-1.5 text-center text-[10.5px] font-medium text-wa-danger">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            {keys.map((key) => (
              <button
                key={key}
                type="button"
                className="mw-keypad-key"
                onClick={() => {
                  setPin((current) => (current.length >= 8 ? current : current + key));
                  setError("");
                }}
              >
                {key}
              </button>
            ))}
            <button
              type="button"
              className="mw-keypad-key text-[12px] text-wa-muted"
              onClick={() => {
                setPin("");
                setError("");
              }}
              aria-label="Clear"
            >
              C
            </button>
            <button
              type="button"
              className="mw-keypad-key"
              onClick={() => {
                setPin((current) => (current.length >= 8 ? current : `${current}0`));
                setError("");
              }}
            >
              0
            </button>
            <button
              type="button"
              className="mw-keypad-key flex items-center justify-center"
              onClick={() => {
                setPin((current) => current.slice(0, -1));
                setError("");
              }}
              aria-label="Backspace"
            >
              <Delete className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            disabled={busy || pin.length < 4}
            onClick={() => void submit()}
            className="mw-btn mw-btn-primary mt-2.5 h-10 w-full"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {t("privacy.unlock")}
          </button>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[9px] text-wa-muted">
          <LockKeyhole className="h-3 w-3" />
          {t("app.name")} · {t("app.poweredBy")}
        </div>
      </div>
    </div>
  );
}

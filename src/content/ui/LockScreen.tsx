import { useEffect, useState } from "react";
import { ArrowRight, Delete, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { verifyPin } from "../../shared/utils/pin";
import { contentController } from "../controller";
import { useAppStore, useT } from "../store";

export function LockScreen() {
  const t = useT();
  const settings = useAppStore((state) => state.settings);
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
      data-madarwa-theme={settings.theme === "auto" ? undefined : settings.theme}
      style={{ pointerEvents: "auto", background: "radial-gradient(900px 600px at 50% 0%, rgba(16,185,129,.16), transparent 60%), #050a14" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("privacy.unlockTitle")}
    >
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mw-hero-orbit relative flex h-16 w-16 items-center justify-center rounded-2xl">
            <LockKeyhole className="h-7 w-7 text-white" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-white">{t("privacy.unlockTitle")}</h1>
          <p className="mt-1 text-xs text-slate-400">{t("privacy.unlockHint")}</p>
        </div>

        <div key={shake} className={shake > 0 ? "mw-shake" : undefined}>
          <div className="mb-5 flex items-center justify-center gap-2.5">
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={index} className="mw-pin-dot" data-filled={index < pin.length} />
            ))}
          </div>

          {error ? (
            <p className="mb-3 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-center text-[12px] font-semibold text-rose-300">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2.5">
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
              className="mw-keypad-key flex items-center justify-center text-sm text-slate-400"
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
              <Delete className="h-5 w-5" />
            </button>
          </div>

          <button
            type="button"
            disabled={busy || pin.length < 4}
            onClick={() => void submit()}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-sm font-bold text-white shadow-lg shadow-emerald-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {t("privacy.unlock")}
          </button>
        </div>

        <div className="mt-7 flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          {t("app.name")} · {t("app.poweredBy")}
        </div>
      </div>
    </div>
  );
}

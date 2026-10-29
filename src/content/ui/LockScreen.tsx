import { useEffect, useState } from "react";
import { ArrowRight, Delete, Loader2, LockKeyhole } from "lucide-react";
import { verifyPin } from "../../shared/utils/pin";
import { contentController } from "../controller";
import { useAppStore, useT } from "../store";
import { BrandMark } from "./BrandMark";

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
      className="mw-app fixed inset-0 z-[2147483600] flex items-center justify-center bg-wa-bg px-4"
      dir={settings.language === "ar" ? "rtl" : "ltr"}
      lang={settings.language}
      style={{ pointerEvents: "auto" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("privacy.unlockTitle")}
    >
      <div className="w-full max-w-[320px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="h-12 w-12" detail="full" />
          <h1 className="mt-3 text-mw-lg font-semibold leading-6">{t("privacy.unlockTitle")}</h1>
          <p className="mt-1 text-mw-xs leading-5 text-wa-muted">{t("privacy.unlockHint")}</p>
        </div>

        <div key={shake} className={shake > 0 ? "mw-shake" : undefined}>
          <div className="mb-4 flex items-center justify-center gap-2" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={index} className="mw-pin-dot" data-filled={index < pin.length} />
            ))}
          </div>

          <div aria-live="assertive">
            {error ? (
              <p className="mb-3 rounded-md border border-wa-danger/25 bg-wa-danger/10 px-2.5 py-1.5 text-center text-mw-xs font-medium text-wa-danger">
                {error}
              </p>
            ) : null}
          </div>

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
              className="mw-keypad-key text-mw-sm text-wa-muted"
              onClick={() => {
                setPin("");
                setError("");
              }}
            >
              {t("common.clear")}
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
              aria-label={t("common.backspace")}
              title={t("common.backspace")}
            >
              <Delete className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            disabled={busy || pin.length < 4}
            onClick={() => void submit()}
            className="mw-btn mw-btn-primary mt-2.5 h-10 w-full"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
            )}
            {t("privacy.unlock")}
          </button>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-mw-2xs text-wa-muted">
          <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
          {t("app.poweredBy")}
        </p>
      </div>
    </div>
  );
}

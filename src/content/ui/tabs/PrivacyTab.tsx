import { useEffect, useState } from "react";
import {
  EyeOff,
  ImageOff,
  KeyRound,
  LockKeyhole,
  MessageSquareOff,
  ShieldCheck,
  Timer,
  UserX,
  VolumeX,
} from "lucide-react";
import { createPinRecord, validatePinFormat } from "../../../shared/utils/pin";
import type { PrivacySettings } from "../../../shared/types";
import { contentController } from "../../controller";
import { useAppStore, useSettings, useT } from "../../store";
import { Alert, Badge, Button, Card, Field, SectionTitle, TextInput, Toggle } from "../components";

export function PrivacyTab() {
  const t = useT();
  const settings = useSettings();
  const setSettings = useAppStore((state) => state.setSettings);
  const pushToast = useAppStore((state) => state.pushToast);
  const privacyGuard = useAppStore((state) => state.privacyGuard);

  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [idle, setIdle] = useState(String(settings.pin.idleMinutes));
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  useEffect(() => {
    setIdle(String(settings.pin.idleMinutes));
  }, [settings.pin.idleMinutes]);

  const patchPrivacy = (patch: Partial<PrivacySettings>) => {
    setSettings({ ...settings, privacy: { ...settings.privacy, ...patch } });
  };

  const togglePin = (enabled: boolean) => {
    if (enabled) {
      setPin("");
      setConfirmPin("");
      setPinError("");
      setPinFormOpen(true);
      return;
    }
    setPinFormOpen(false);
    setSettings({
      ...settings,
      pin: { ...settings.pin, enabled: false, hash: "", salt: "" },
    });
    pushToast({ kind: "info", title: t("privacy.pinDisabled"), body: "" });
  };

  const savePin = async () => {
    const format = validatePinFormat(pin);
    if (!format.valid) {
      setPinError(t("privacy.pinWeak"));
      return;
    }
    if (pin !== confirmPin) {
      setPinError(t("privacy.pinMismatch"));
      return;
    }
    setPinBusy(true);
    setPinError("");
    try {
      const record = await createPinRecord(pin);
      const idleMinutes = Math.min(480, Math.max(1, Number(idle) || 30));
      setSettings({
        ...settings,
        pin: {
          enabled: true,
          hash: record.hash,
          salt: record.salt,
          idleMinutes,
        },
      });
      setPin("");
      setConfirmPin("");
      setPinFormOpen(false);
      pushToast({ kind: "success", title: t("privacy.pinSaved"), body: "" });
    } catch (error) {
      setPinError(error instanceof Error ? error.message : t("errors.generic"));
    } finally {
      setPinBusy(false);
    }
  };

  const applyIdle = () => {
    const value = Math.min(480, Math.max(1, Number(idle) || 30));
    setIdle(String(value));
    if (value !== settings.pin.idleMinutes) {
      setSettings({ ...settings, pin: { ...settings.pin, idleMinutes: value } });
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        icon={<ShieldCheck className="h-4 w-4" />}
        title={t("privacy.title")}
        subtitle={t("privacy.subtitle")}
      />

      <Card className="p-0">
        <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
          <EyeOff className="h-3.5 w-3.5 text-wa-brand" />
          <h3 className="text-[11px] font-semibold">{t("privacy.blurSection")}</h3>
        </div>
        <Toggle
          checked={settings.privacy.blurPreview}
          onChange={(value) => patchPrivacy({ blurPreview: value })}
          label={t("privacy.blurPreview")}
          hint={t("privacy.blurPreviewHint")}
        />
        <Toggle
          checked={settings.privacy.blurNames}
          onChange={(value) => patchPrivacy({ blurNames: value })}
          label={t("privacy.blurNames")}
          hint={t("privacy.blurNamesHint")}
        />
        <Toggle
          checked={settings.privacy.blurAvatars}
          onChange={(value) => patchPrivacy({ blurAvatars: value })}
          label={t("privacy.blurAvatars")}
          hint={t("privacy.blurAvatarsHint")}
        />
        <Toggle
          checked={settings.privacy.blurMessages}
          onChange={(value) => patchPrivacy({ blurMessages: value })}
          label={t("privacy.blurMessages")}
          hint={t("privacy.blurMessagesHint")}
        />
        <Toggle
          checked={settings.privacy.blurMedia}
          onChange={(value) => patchPrivacy({ blurMedia: value })}
          label={t("privacy.blurMedia")}
          hint={t("privacy.blurMediaHint")}
        />
      </Card>

      <Card className="p-0">
        <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
          <UserX className="h-3.5 w-3.5 text-wa-brand" />
          <h3 className="text-[11px] font-semibold">{t("privacy.presenceSection")}</h3>
        </div>
        <Toggle
          checked={settings.privacy.hidePresence}
          onChange={(value) => patchPrivacy({ hidePresence: value })}
          label={t("privacy.hidePresence")}
          hint={t("privacy.hidePresenceHint")}
          warning
        />
        <Toggle
          checked={settings.privacy.hideTyping}
          onChange={(value) => patchPrivacy({ hideTyping: value })}
          label={t("privacy.hideTyping")}
          hint={t("privacy.hideTypingHint")}
        />
      </Card>

      <Card className="p-0">
        <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
          <MessageSquareOff className="h-3.5 w-3.5 text-wa-brand" />
          <h3 className="text-[11px] font-semibold">{t("privacy.receiptsSection")}</h3>
        </div>
        <Toggle
          checked={settings.privacy.disableReadReceipts}
          onChange={(value) => patchPrivacy({ disableReadReceipts: value })}
          label={t("privacy.disableReadReceipts")}
          hint={t("privacy.disableReadReceiptsHint")}
          warning
        />
        <Toggle
          checked={settings.privacy.disableAudioReceipts}
          onChange={(value) => patchPrivacy({ disableAudioReceipts: value })}
          label={t("privacy.disableAudioReceipts")}
          hint={t("privacy.disableAudioReceiptsHint")}
        />
        {settings.privacy.disableAudioReceipts && privacyGuard ? (
          <div className="px-1.5 pb-1.5">
            <Badge tone={privacyGuard.active ? "success" : "warning"}>
              {privacyGuard.active ? t("privacy.guardActive") : t("privacy.guardUnsupported")}
            </Badge>
          </div>
        ) : null}
        <div className="mt-1 px-1">
          <Alert tone="warning">{t("privacy.warning")}</Alert>
        </div>
      </Card>

      <Card className="p-0">
        <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
          <KeyRound className="h-3.5 w-3.5 text-wa-brand" />
          <h3 className="text-[11px] font-semibold">{t("privacy.lockSection")}</h3>
          {settings.pin.enabled ? <Badge tone="success">{t("common.on")}</Badge> : null}
        </div>

        <Toggle
          checked={settings.pin.enabled || pinFormOpen}
          onChange={togglePin}
          label={t("privacy.lockEnable")}
          hint={t("privacy.lockEnableHint")}
        />

        {settings.pin.enabled && !pinFormOpen ? (
          <div className="mt-2 space-y-3 rounded-md border border-wa-line px-3 py-3">
            <div className="flex items-end gap-2">
              <Field label={t("privacy.idleMinutes")} className="flex-1">
                <div className="relative">
                  <Timer className="absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-wa-muted" />
                  <TextInput
                    className="ps-8"
                    type="number"
                    min={1}
                    max={480}
                    value={idle}
                    onChange={(event) => setIdle(event.target.value)}
                    onBlur={applyIdle}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyIdle();
                    }}
                  />
                </div>
              </Field>
              <Button variant="secondary" size="sm" onClick={() => setPinFormOpen(true)}>
                {t("common.edit")}
              </Button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<LockKeyhole className="h-3.5 w-3.5" />}
              onClick={() => contentController.lockNow()}
              className="w-full"
            >
              {t("privacy.lockNow")}
            </Button>
          </div>
        ) : null}

        {pinFormOpen ? (
          <div className="mt-2 space-y-3 rounded-md border border-wa-brand/25 bg-wa-brand/5 px-3 py-3">
            <Field label={t("privacy.pinCode")}>
              <TextInput
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                placeholder="••••"
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 8));
                  setPinError("");
                }}
              />
            </Field>
            <Field label={t("privacy.pinConfirm")}>
              <TextInput
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                placeholder="••••"
                value={confirmPin}
                onChange={(event) => {
                  setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 8));
                  setPinError("");
                }}
              />
            </Field>
            <Field label={t("privacy.idleMinutes")} error={pinError}>
              <div className="relative">
                <Timer className="absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-wa-muted" />
                <TextInput
                  className="ps-8"
                  type="number"
                  min={1}
                  max={480}
                  value={idle}
                  onChange={(event) => setIdle(event.target.value)}
                />
              </div>
            </Field>
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={pinBusy}
                onClick={() => void savePin()}
                disabled={pin.length < 4 || confirmPin.length < 4}
                className="flex-1"
              >
                {t("common.save")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPinFormOpen(false);
                  setPin("");
                  setConfirmPin("");
                  setPinError("");
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : null}

        {!settings.pin.enabled && !pinFormOpen ? (
          <p className="text-wa-muted px-2.5 pb-2 pt-1 text-[10px] leading-5">
            <VolumeX className="me-1 inline h-3 w-3" />
            {t("privacy.lockEnableHint")}
          </p>
        ) : null}
      </Card>

      <div className="flex items-center justify-center gap-1.5 pb-2 text-[10px] text-wa-muted">
        <ImageOff className="h-3 w-3" />
        <ShieldCheck className="h-3 w-3 text-wa-brand" />
        {t("app.poweredBy")}
      </div>
    </div>
  );
}

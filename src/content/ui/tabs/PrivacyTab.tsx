import { useEffect, useState } from "react";
import {
  EyeOff,
  KeyRound,
  LockKeyhole,
  MessageSquareOff,
  ShieldCheck,
  ShieldOff,
  Timer,
  UserX,
  VolumeX,
} from "lucide-react";
import { createPinRecord, validatePinFormat } from "../../../shared/utils/pin";
import type { PrivacySettings } from "../../../shared/types";
import { contentController } from "../../controller";
import { useAppStore, useSettings, useT } from "../../store";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigureButton,
  Disclosure,
  Field,
  SectionTitle,
  TextInput,
  Toggle,
} from "../components";

const ALL_PRIVACY_ON: PrivacySettings = {
  blurPreview: true,
  blurNames: true,
  blurPhoneNumbers: true,
  blurAvatars: true,
  blurMessages: true,
  blurMedia: true,
  hidePresence: true,
  hideTyping: true,
  disableReadReceipts: true,
  disableAudioReceipts: true,
};

const ALL_PRIVACY_OFF: PrivacySettings = {
  blurPreview: false,
  blurNames: false,
  blurPhoneNumbers: false,
  blurAvatars: false,
  blurMessages: false,
  blurMedia: false,
  hidePresence: false,
  hideTyping: false,
  disableReadReceipts: false,
  disableAudioReceipts: false,
};

export function PrivacyTab() {
  const t = useT();
  const settings = useSettings();
  const setSettings = useAppStore((state) => state.setSettings);
  const pushToast = useAppStore((state) => state.pushToast);
  const privacyGuard = useAppStore((state) => state.privacyGuard);

  const [lockOpen, setLockOpen] = useState(false);
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

  const applyPreset = (privacy: PrivacySettings, message: string) => {
    setSettings({ ...settings, privacy });
    pushToast({ kind: "success", title: message, body: "" });
  };

  const togglePin = (enabled: boolean) => {
    if (enabled) {
      setPin("");
      setConfirmPin("");
      setPinError("");
      setLockOpen(true);
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
    <div className="space-y-3">
      <SectionTitle
        icon={<ShieldCheck className="h-4 w-4" />}
        title={t("privacy.title")}
        subtitle={t("privacy.subtitle")}
      />

      <Card className="p-2">
        <div className="mb-1.5 px-0.5">
          <h3 className="text-[10px] font-semibold text-wa-muted">{t("privacy.quickActions")}</h3>
        </div>
        <div className="grid gap-1.5">
          <Button
            size="sm"
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            className="w-full"
            onClick={() => applyPreset(ALL_PRIVACY_ON, t("privacy.presetStealth"))}
          >
            {t("privacy.fullStealth")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ShieldOff className="h-3.5 w-3.5" />}
            className="w-full"
            onClick={() => applyPreset(ALL_PRIVACY_OFF, t("privacy.presetOff"))}
          >
            {t("privacy.disableAll")}
          </Button>
        </div>
        <p className="text-wa-muted px-0.5 pb-0.5 pt-1.5 text-[9.5px] leading-4">
          {t("privacy.fullStealthHint")}
        </p>
      </Card>

      <Card className="p-0">
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
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
          checked={settings.privacy.blurPhoneNumbers}
          onChange={(value) => patchPrivacy({ blurPhoneNumbers: value })}
          label={t("privacy.blurPhoneNumbers")}
          hint={t("privacy.blurPhoneNumbersHint")}
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
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
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
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
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
          action={
            settings.privacy.disableAudioReceipts && privacyGuard ? (
              <Badge tone={privacyGuard.active ? "success" : "warning"}>
                {privacyGuard.active ? t("privacy.guardActive") : t("privacy.guardUnsupported")}
              </Badge>
            ) : undefined
          }
        />
        {settings.privacy.disableReadReceipts || settings.privacy.disableAudioReceipts ? (
          <div className="px-2 pb-2">
            <Alert tone="warning">{t("privacy.warning")}</Alert>
          </div>
        ) : null}
      </Card>

      <Card className="p-0">
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
          <KeyRound className="h-3.5 w-3.5 text-wa-brand" />
          <h3 className="text-[11px] font-semibold">{t("privacy.lockSection")}</h3>
          {settings.pin.enabled ? <Badge tone="success">{t("common.on")}</Badge> : null}
        </div>

        <Toggle
          checked={settings.pin.enabled || pinFormOpen}
          onChange={togglePin}
          label={t("privacy.lockEnable")}
          hint={settings.pin.enabled || pinFormOpen ? undefined : t("privacy.lockEnableHint")}
          action={
            settings.pin.enabled || pinFormOpen ? (
              <ConfigureButton
                open={lockOpen}
                onClick={() => setLockOpen((value) => !value)}
                label={t("common.configure")}
                title={t("privacy.settingsAdvanced")}
              />
            ) : undefined
          }
        />

        <Disclosure open={lockOpen && (settings.pin.enabled || pinFormOpen)}>
          <div className="space-y-3">
            {settings.pin.enabled && !pinFormOpen ? (
              <>
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
              </>
            ) : null}

            {pinFormOpen ? (
              <div className="space-y-3">
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
                      if (!settings.pin.enabled) setLockOpen(false);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : null}

            {!settings.pin.enabled && !pinFormOpen ? (
              <p className="text-wa-muted flex items-center gap-1 text-[10px] leading-5">
                <VolumeX className="h-3 w-3 shrink-0" />
                {t("privacy.lockEnableHint")}
              </p>
            ) : null}
          </div>
        </Disclosure>
      </Card>
    </div>
  );
}

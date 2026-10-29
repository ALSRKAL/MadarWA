import { useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  CircleX,
  ExternalLink,
  Link2,
  MessageCircle,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { BRIDGE_COMMANDS, EXTENSION_VERSION, PROJECT_DOCS_URL, PROJECT_URL } from "../../../shared/constants";
import { describeError } from "../../../shared/errors";
import { formatDateTime } from "../../../shared/format";
import { sanitizePhone } from "../../../shared/utils/phone";
import { validateWebhookUrl } from "../../../shared/utils/security";
import { contentController } from "../../controller";
import { useAppStore, useSettings, useT } from "../../store";
import {
  Alert,
  Button,
  Card,
  ConfigureButton,
  CopyButton,
  Disclosure,
  Field,
  GroupLabel,
  SectionTitle,
  TextArea,
  TextInput,
  Toggle,
} from "../components";

/** URL validation codes that mean "local or private address", not a typo. */
const PRIVATE_URL_CODES = new Set(["private-host", "single-label", "private-ip"]);

export function ToolsTab() {
  const t = useT();
  const settings = useSettings();
  const setSettings = useAppStore((state) => state.setSettings);
  const pushToast = useAppStore((state) => state.pushToast);
  const webhookLog = useAppStore((state) => state.webhookLog);

  const [phone, setPhone] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [chatBusy, setChatBusy] = useState<"open" | "send" | "">("");

  const [enabled, setEnabled] = useState(settings.webhook.enabled);
  const [url, setUrl] = useState(settings.webhook.url);
  const [token, setToken] = useState(settings.webhook.token);
  const [forwardMessages, setForwardMessages] = useState(settings.webhook.forwardMessages);
  const [forwardRevoked, setForwardRevoked] = useState(settings.webhook.forwardRevoked);
  const [webhookError, setWebhookError] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; status: number; error: string } | null>(null);

  useEffect(() => {
    setEnabled(settings.webhook.enabled);
    setUrl(settings.webhook.url);
    setToken(settings.webhook.token);
    setForwardMessages(settings.webhook.forwardMessages);
    setForwardRevoked(settings.webhook.forwardRevoked);
  }, [settings.webhook]);

  const urlCheck = useMemo(() => (url.trim() ? validateWebhookUrl(url) : null), [url]);

  const applyWebhook = (): boolean => {
    if (enabled && !url.trim()) {
      setWebhookError(t("tools.invalidUrl"));
      return false;
    }
    if (url.trim()) {
      const check = validateWebhookUrl(url);
      if (!check.ok) {
        setWebhookError(t("tools.invalidUrl"));
        return false;
      }
    }
    setWebhookError("");
    setSettings({
      ...settings,
      webhook: {
        enabled,
        url: url.trim(),
        token: token.trim().slice(0, 256),
        forwardMessages,
        forwardRevoked,
      },
    });
    return true;
  };

  // The switch commits at once like every other switch in the panel. Turning
  // it on needs a valid saved URL; until then the form opens and explains.
  const setWebhookEnabled = (value: boolean) => {
    setEnabled(value);
    const current = useAppStore.getState().settings;
    if (!value) {
      setWebhookError("");
      if (current.webhook.enabled) {
        setSettings({ ...current, webhook: { ...current.webhook, enabled: false } });
        pushToast({ kind: "info", title: t("tools.webhookDisabled"), body: "" });
      }
      return;
    }
    if (validateWebhookUrl(current.webhook.url).ok) {
      setSettings({ ...current, webhook: { ...current.webhook, enabled: true } });
      return;
    }
    setConfigOpen(true);
    setWebhookError(t("tools.webhookNeedsUrl"));
  };

  const saveWebhook = async () => {
    if (saving || !applyWebhook()) return;
    setSaving(true);
    try {
      const saved = await contentController.saveNow();
      pushToast(
        saved
          ? { kind: "success", title: t("tools.saved"), body: "" }
          : { kind: "error", title: t("errors.saveFailed"), body: "" },
      );
    } finally {
      setSaving(false);
    }
  };

  const clearLog = async () => {
    await contentController.clearWebhookLog();
    pushToast({ kind: "info", title: t("tools.logCleared"), body: "" });
  };

  const testWebhook = async () => {
    if (!applyWebhook()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await contentController.testWebhook();
      setTestResult(result);
      pushToast({
        kind: result.ok ? "success" : "error",
        title: result.ok
          ? t("tools.testSuccess", { status: result.status })
          : t("tools.testFailed", { error: result.error || result.status || "" }),
        body: "",
      });
      await contentController.refreshWebhookLog();
    } finally {
      setTesting(false);
    }
  };

  const startChat = async (send: boolean) => {
    const sanitized = sanitizePhone(phone, settings.broadcaster.defaultCountryCode);
    if (!sanitized.valid) {
      pushToast({ kind: "error", title: t("tools.invalidPhone"), body: "" });
      return;
    }
    setChatBusy(send ? "send" : "open");
    try {
      const result = await contentController.request<{ chatId: string; opened: boolean; sent: boolean }>(
        BRIDGE_COMMANDS.startChat,
        {
          phone: sanitized.digits,
          countryCode: settings.broadcaster.defaultCountryCode,
          message: send ? firstMessage : "",
        },
        60_000,
      );
      pushToast({
        kind: "success",
        title: result.sent ? t("tools.messageSent") : t("tools.chatOpened"),
        body: `+${sanitized.digits}`,
      });
    } catch (error) {
      const { title, detail } = describeError(error, t);
      pushToast({ kind: "error", title, body: detail });
    } finally {
      setChatBusy("");
    }
  };

  const samplePayload = useMemo(
    () =>
      JSON.stringify(
        {
          event: "message",
          source: "madarwa",
          at: Date.now(),
          data: {
            id: "false_966501234567@c.us_ABCDEF",
            chatId: "966501234567@c.us",
            chatName: "Example",
            sender: "966501234567@c.us",
            senderName: "Example",
            text: "Hello from MadarWA",
            messageType: "chat",
            timestamp: Date.now(),
            isGroup: false,
            fromMe: false,
          },
        },
        null,
        2,
      ),
    [],
  );

  return (
    <div className="space-y-3">
      <SectionTitle title={t("tools.title")} subtitle={t("tools.subtitle")} />

      <Card>
        <SectionTitle
          size="card"
          icon={<MessageCircle className="h-4 w-4" />}
          title={t("tools.startChat")}
          subtitle={t("tools.startChatHint")}
        />
        <Field label={t("common.phone")}>
          <TextInput
            dir="ltr"
            className="mw-code text-left"
            inputMode="tel"
            placeholder={t("tools.phonePlaceholder")}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field label={t("tools.messageOptional")} className="mt-2">
          <TextArea
            dir="auto"
            className="min-h-[70px]"
            value={firstMessage}
            onChange={(event) => setFirstMessage(event.target.value)}
          />
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={chatBusy === "open"}
            disabled={chatBusy !== "" || !phone.trim()}
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => void startChat(false)}
          >
            {t("tools.openChat")}
          </Button>
          <Button
            size="sm"
            loading={chatBusy === "send"}
            disabled={chatBusy !== "" || !phone.trim() || !firstMessage.trim()}
            icon={<Send className="h-3.5 w-3.5" />}
            onClick={() => void startChat(true)}
          >
            {t("tools.sendNow")}
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <div className="px-3 pt-3">
          <SectionTitle
            size="card"
            icon={<Link2 className="h-4 w-4" />}
            title={t("tools.webhook")}
            subtitle={t("tools.webhookHint")}
          />
        </div>

        <Toggle checked={enabled} onChange={setWebhookEnabled} label={t("tools.webhookEnable")} />

        {enabled ? (
          <div className="px-3 pb-2">
            <div className="flex items-center justify-between gap-2 border-t border-wa-line pt-2">
              <span className="mw-code min-w-0 truncate text-mw-xs text-wa-muted" dir="ltr">
                {settings.webhook.url || t("tools.webhookUrl")}
              </span>
              <ConfigureButton
                open={configOpen}
                onClick={() => setConfigOpen((value) => !value)}
                label={t("common.configure")}
                title={t("tools.webhook")}
              />
            </div>

            <Disclosure open={configOpen}>
              <div className="space-y-2.5">
                <Field label={t("tools.webhookUrl")} error={webhookError}>
                  <TextInput
                    dir="ltr"
                    className="mw-code text-left"
                    placeholder={t("tools.webhookUrlPlaceholder")}
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setWebhookError("");
                    }}
                    onBlur={() => {
                      if (url.trim() && urlCheck && !urlCheck.ok) setWebhookError(t("tools.invalidUrl"));
                    }}
                  />
                </Field>
                {urlCheck && !urlCheck.ok && PRIVATE_URL_CODES.has(urlCheck.code) ? (
                  <Alert tone="warning">{t("tools.privateBlocked")}</Alert>
                ) : null}
                <Field label={t("tools.webhookToken")} hint={t("tools.webhookTokenHint")}>
                  <TextInput
                    dir="ltr"
                    className="mw-code text-left"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                </Field>
                <WebhookForwardToggles
                  forwardMessages={forwardMessages}
                  forwardRevoked={forwardRevoked}
                  setForwardMessages={setForwardMessages}
                  setForwardRevoked={setForwardRevoked}
                  labels={{ messages: t("tools.forwardMessages"), revoked: t("tools.forwardRevoked") }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={saving} onClick={() => void saveWebhook()}>
                    {t("common.save")}
                  </Button>
                  <Button
                    size="sm"
                    loading={testing}
                    icon={<Webhook className="h-3.5 w-3.5" />}
                    onClick={() => void testWebhook()}
                    disabled={!url.trim()}
                  >
                    {testing ? t("tools.testing") : t("tools.test")}
                  </Button>
                </div>
                {testResult ? (
                  <Alert tone={testResult.ok ? "success" : "danger"}>
                    {testResult.ok
                      ? t("tools.testSuccess", { status: testResult.status })
                      : t("tools.testFailed", { error: testResult.error || testResult.status || "" })}
                  </Alert>
                ) : null}

                <div className="border-t border-wa-line pt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <h4 className="text-mw-xs font-semibold">{t("tools.payloadTitle")}</h4>
                    <CopyButton text={samplePayload} label={t("common.copy")} copiedLabel={t("common.copied")} />
                  </div>
                  <pre className="mw-code mw-scroll max-h-40 overflow-auto rounded-md bg-wa-raised p-2.5 text-mw-2xs leading-5">
                    {samplePayload}
                  </pre>
                </div>
              </div>
            </Disclosure>
          </div>
        ) : null}

        {webhookLog.length > 0 ? (
          <div className="border-t border-wa-line px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-mw-sm font-semibold">{t("tools.logs")}</h4>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => void contentController.refreshWebhookLog()}
                >
                  {t("common.refresh")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => void clearLog()}
                >
                  {t("common.clear")}
                </Button>
              </div>
            </div>

            <ul className="mw-scroll max-h-44 divide-y divide-wa-line overflow-y-auto">
              {webhookLog.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 py-1.5 text-mw-xs">
                  {entry.ok ? (
                    <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-wa-success" aria-hidden="true" />
                  ) : (
                    <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-wa-danger" aria-hidden="true" />
                  )}
                  <span className="mw-sr-only">{entry.ok ? t("tools.logOk") : t("tools.logFailed")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="mw-code truncate" dir="ltr">
                      {entry.url}
                    </p>
                    {entry.error || (entry.attempts ?? 1) > 1 ? (
                      <p className="text-wa-muted truncate text-mw-2xs">
                        {[entry.error, (entry.attempts ?? 1) > 1 ? t("tools.attempts", { count: entry.attempts }) : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <span className="mw-lang-pill shrink-0 text-mw-2xs">{entry.status || "—"}</span>
                  <span className="text-wa-muted mw-lang-pill shrink-0 text-mw-2xs">{formatDateTime(entry.at, settings.language)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* Rows sit on the panel itself: frame, sheet and panel are the only levels. */}
      <Card className="p-0">
        <GroupLabel icon={<ExternalLink className="h-3.5 w-3.5" />}>{t("tools.quickLinks")}</GroupLabel>
        <div className="divide-y divide-wa-line">
          {[
            { href: PROJECT_URL, label: t("tools.repo") },
            { href: PROJECT_DOCS_URL, label: t("tools.docs") },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2.5 text-mw-sm font-medium hover:bg-wa-hover"
            >
              {link.label}
              <ExternalLink className="h-3.5 w-3.5 text-wa-muted" aria-hidden="true" />
            </a>
          ))}
        </div>
        <p className="mw-lang-pill border-t border-wa-line px-3 py-2 text-mw-xs text-wa-muted">
          {t("app.name")} · {t("popup.version", { version: EXTENSION_VERSION })}
        </p>
      </Card>
    </div>
  );
}

function WebhookForwardToggles({
  forwardMessages,
  forwardRevoked,
  setForwardMessages,
  setForwardRevoked,
  labels,
}: {
  forwardMessages: boolean;
  forwardRevoked: boolean;
  setForwardMessages: (value: boolean) => void;
  setForwardRevoked: (value: boolean) => void;
  labels: { messages: string; revoked: string };
}) {
  return (
    <>
      <Toggle checked={forwardMessages} onChange={setForwardMessages} label={labels.messages} />
      <Toggle checked={forwardRevoked} onChange={setForwardRevoked} label={labels.revoked} />
    </>
  );
}

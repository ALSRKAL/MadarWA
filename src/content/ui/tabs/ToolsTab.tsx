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
import { BRIDGE_COMMANDS, EXTENSION_VERSION } from "../../../shared/constants";
import { formatDateTime } from "../../../shared/format";
import { sanitizePhone } from "../../../shared/utils/phone";
import { validateWebhookUrl } from "../../../shared/utils/security";
import { contentController } from "../../controller";
import { useAppStore, useSettings, useT } from "../../store";
import {
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  Field,
  SectionTitle,
  TextArea,
  TextInput,
  Toggle,
} from "../components";

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

  const saveWebhook = async () => {
    if (!applyWebhook()) return;
    await contentController.saveNow();
    pushToast({ kind: "success", title: t("tools.saved"), body: "" });
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
      pushToast({ kind: "error", title: t("tools.invalidPhone"), body: sanitized.reason });
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
        body: result.chatId,
      });
    } catch (error) {
      pushToast({
        kind: "error",
        title: t("errors.generic"),
        body: error instanceof Error ? error.message.slice(0, 200) : "",
      });
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
      <SectionTitle
        icon={<Webhook className="h-4 w-4" />}
        title={t("tools.title")}
        subtitle={t("tools.subtitle")}
        action={<Badge tone="neutral">v{EXTENSION_VERSION}</Badge>}
      />

      <Card>
        <SectionTitle
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

      <Card>
        <SectionTitle
          icon={<Link2 className="h-4 w-4" />}
          title={t("tools.webhook")}
          subtitle={t("tools.webhookHint")}
          action={<Badge tone={enabled ? "success" : "neutral"}>{enabled ? t("common.on") : t("common.off")}</Badge>}
        />

        <div className="space-y-2.5">
          <Toggle checked={enabled} onChange={setEnabled} label={t("tools.webhookEnable")} />
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
          {urlCheck && !urlCheck.ok ? <Alert tone="warning">{t("tools.privateBlocked")}</Alert> : null}
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
            <Button size="sm" variant="secondary" onClick={() => void saveWebhook()}>
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
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[11px] font-bold">{t("tools.logs")}</h4>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void contentController.refreshWebhookLog()}
                className="text-wa-muted inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold hover:bg-wa-hover hover:text-wa-text"
              >
                <RefreshCw className="h-3 w-3" />
                {t("common.refresh")}
              </button>
              {webhookLog.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void contentController.clearWebhookLog()}
                  className="text-wa-muted inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold hover:bg-wa-hover hover:text-wa-text"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("common.clear")}
                </button>
              ) : null}
            </div>
          </div>

          {webhookLog.length === 0 ? (
            <EmptyState title={t("tools.noLogs")} icon={<Webhook className="h-7 w-7" />} />
          ) : (
            <div className="mw-scroll max-h-44 space-y-1 overflow-y-auto rounded-md border border-wa-line bg-wa-input p-1.5">
              {webhookLog.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 rounded-lg px-1.5 py-1 text-[10px]">
                  {entry.ok ? (
                    <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-wa-brand" />
                  ) : (
                    <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-wa-danger" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="mw-code truncate text-[9.5px]" dir="ltr">
                      {entry.url}
                    </p>
                    {entry.error ? <p className="text-wa-muted truncate text-[9px]">{entry.error}</p> : null}
                  </div>
                  <span className="mw-lang-pill shrink-0 text-[9px]">{entry.status || "—"}</span>
                  <span className="text-wa-muted mw-lang-pill shrink-0 text-[9px]">{formatDateTime(entry.at, settings.language)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-[11px] font-bold">{t("tools.payloadTitle")}</h4>
            <CopyButton text={samplePayload} label={t("common.copy")} copiedLabel={t("common.copied")} />
          </div>
          <pre className="mw-code mw-scroll max-h-40 overflow-auto rounded-md border border-wa-line bg-wa-input p-2.5 text-[9.5px] leading-5">
            {samplePayload}
          </pre>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<ExternalLink className="h-4 w-4" />} title={t("tools.quickLinks")} />
        <div className="mw-card divide-y divide-wa-line">
          <a
            href="https://github.com/ALSRKAL/MadarWA"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-3 py-2 text-[10.5px] font-medium hover:bg-wa-hover"
          >
            {t("tools.repo")}
            <ExternalLink className="h-3.5 w-3.5 text-wa-brand" />
          </a>
          <a
            href="https://github.com/ALSRKAL/MadarWA#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-3 py-2 text-[10.5px] font-medium hover:bg-wa-hover"
          >
            {t("tools.docs")}
            <ExternalLink className="h-3.5 w-3.5 text-wa-brand" />
          </a>
        </div>
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

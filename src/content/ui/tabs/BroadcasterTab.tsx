import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCheck,
  Download,
  Eye,
  FileSpreadsheet,
  ImageIcon,
  Megaphone,
  Minus,
  Pause,
  Play,
  RefreshCw,
  Send,
  Square,
  Upload,
  UserX,
  X,
} from "lucide-react";
import { readSheet } from "read-excel-file/browser";
import { connectionHintKey, connectionLabelKey } from "../../../shared/connection";
import { CAMPAIGN, UI_LIMITS } from "../../../shared/constants";
import { describeError } from "../../../shared/errors";
import { formatNumber, formatTime } from "../../../shared/format";
import { formatBytes } from "../../../shared/utils/media";
import { useAppStore, useConnectionPhase, useSettings, useT } from "../../store";
import { downloadText, readFileAsArrayBuffer, readFileAsText } from "../../../shared/storage";
import type { BroadcasterSettings, CampaignStatus } from "../../../shared/types";
import { parseCsv, recipientsFromRows, rowsFromMatrix, toCsv } from "../../../shared/utils/csv";
import { personalizeMessage } from "../../../shared/utils/template";
import { attachmentSize, parseManualRecipients, type Attachment } from "../../broadcast";
import { contentController } from "../../controller";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigureButton,
  Disclosure,
  Field,
  Modal,
  Progress,
  SectionTitle,
  Stat,
  Stepper,
  TextArea,
  TextInput,
  Toggle,
  cn,
} from "../components";

function statusTone(status: CampaignStatus): "neutral" | "success" | "warning" | "danger" | "brand" {
  if (status === "completed") return "success";
  if (status === "running") return "brand";
  if (status === "paused") return "warning";
  if (status === "stopped") return "danger";
  return "neutral";
}

/** Rough duration: jittered gaps between sends, with a rest replacing the gap at each batch boundary. */
function estimateCampaignSeconds(count: number, settings: BroadcasterSettings): number {
  if (count <= 1) return 0;
  const gaps = count - 1;
  const rests = settings.batchCooldownSec > 0 ? Math.floor(gaps / Math.max(1, settings.batchSize)) : 0;
  const averageGap = (settings.minDelaySec + Math.max(settings.minDelaySec, settings.maxDelaySec)) / 2;
  return (gaps - rests) * averageGap + rests * settings.batchCooldownSec;
}

function formatDuration(seconds: number, t: (key: string, variables?: Record<string, unknown>) => string): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? t("common.durationHours", { hours, minutes }) : t("common.durationMinutes", { minutes: totalMinutes });
}

const LOG_ICONS = {
  sent: { icon: Check, className: "bg-wa-brand/15 text-wa-brand", key: "broadcaster.sent" },
  failed: { icon: X, className: "bg-wa-danger/15 text-wa-danger", key: "broadcaster.failed" },
  invalid: { icon: UserX, className: "bg-wa-warning/15 text-wa-warning", key: "broadcaster.invalid" },
  skipped: { icon: Minus, className: "bg-wa-muted/15 text-wa-muted", key: "broadcaster.skipped" },
} as const;

export function BroadcasterTab() {
  const t = useT();
  const settings = useSettings();
  const setSettings = useAppStore((state) => state.setSettings);
  const pushToast = useAppStore((state) => state.pushToast);
  const campaign = useAppStore((state) => state.campaign);
  const recipients = useAppStore((state) => state.recipients);
  const validation = useAppStore((state) => state.validation);
  const phase = useConnectionPhase();

  const [step, setStep] = useState(1);
  const [antiBanOpen, setAntiBanOpen] = useState(false);
  const [numbersText, setNumbersText] = useState("");
  const deferredText = useDeferredValue(numbersText);
  const [fileRecipients, setFileRecipients] = useState<ReturnType<typeof parseManualRecipients>["recipients"]>([]);
  const [fileName, setFileName] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [starting, setStarting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const manual = useMemo(
    () => parseManualRecipients(deferredText, settings.broadcaster.defaultCountryCode),
    [deferredText, settings.broadcaster.defaultCountryCode],
  );

  const combined = useMemo(() => {
    const seen = new Set<string>();
    const list = [...manual.recipients];
    for (const recipient of fileRecipients) {
      if (seen.has(recipient.phone)) continue;
      seen.add(recipient.phone);
      list.push(recipient);
    }
    for (const recipient of list) seen.add(recipient.phone);
    return {
      recipients: list,
      invalid: manual.invalid,
      duplicates: manual.duplicates + Math.max(0, manual.recipients.length + fileRecipients.length - list.length),
    };
  }, [fileRecipients, manual]);

  const patchBroadcaster = (patch: Partial<BroadcasterSettings>) => {
    setSettings({ ...settings, broadcaster: { ...settings.broadcaster, ...patch } });
  };

  const setNumber = (key: keyof BroadcasterSettings, raw: string, min: number, max: number) => {
    const parsed = Number(raw);
    const value = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : min;
    patchBroadcaster({ [key]: value } as Partial<BroadcasterSettings>);
  };

  const handleRecipientFile = async (file: File) => {
    setFileBusy(true);
    try {
      const isExcel = /\.xlsx$/i.test(file.name);
      let rows: Record<string, string>[];
      let headers: string[];
      if (isExcel) {
        const buffer = await readFileAsArrayBuffer(file);
        const matrix = await readSheet(buffer);
        const parsed = rowsFromMatrix(matrix as unknown[][]);
        headers = parsed.headers;
        rows = parsed.rows;
      } else {
        const text = await readFileAsText(file);
        const parsed = parseCsv(text);
        headers = parsed.headers;
        rows = parsed.rows;
      }
      const result = recipientsFromRows(headers, rows, settings.broadcaster.defaultCountryCode);
      if (result.recipients.length > UI_LIMITS.maxCampaignRecipients) {
        pushToast({
          kind: "error",
          title: t("broadcaster.tooManyRecipients", {
            max: formatNumber(UI_LIMITS.maxCampaignRecipients, settings.language),
          }),
          body: "",
        });
        return;
      }
      const mapped = result.recipients.map((recipient) => ({
        ...recipient,
        status: "pending" as const,
        reason: "",
      }));
      setFileRecipients(mapped);
      setFileName(file.name);
      pushToast({ kind: "success", title: t("broadcaster.parsedCount", { count: mapped.length }), body: "" });
    } catch (error) {
      const { title, detail } = describeError(error, t);
      pushToast({ kind: "error", title, body: detail });
    } finally {
      setFileBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const attachmentTooLarge = () =>
    pushToast({
      kind: "error",
      title: t("broadcaster.attachmentTooLarge", {
        size: formatBytes(CAMPAIGN.maxAttachmentBytes, settings.language),
      }),
      body: "",
    });

  const handleAttachment = async (file: File) => {
    if (file.size > CAMPAIGN.maxAttachmentBytes) {
      attachmentTooLarge();
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      return;
    }
    try {
      const next = await contentController.attachmentFromFile(file);
      if (attachmentSize(next.dataUrl) > CAMPAIGN.maxAttachmentBytes) {
        attachmentTooLarge();
        return;
      }
      setAttachment(next);
    } catch (error) {
      const { title, detail } = describeError(error, t);
      pushToast({ kind: "error", title, body: detail });
    } finally {
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  };

  const startCampaign = async () => {
    if (starting || campaign.status === "running" || campaign.status === "paused") return;
    if (combined.recipients.length === 0) {
      pushToast({ kind: "error", title: t("broadcaster.noRecipients"), body: "" });
      return;
    }
    if (!message.trim() && !attachment) {
      pushToast({ kind: "error", title: t("broadcaster.noMessage"), body: "" });
      return;
    }
    if (settings.broadcaster.minDelaySec > settings.broadcaster.maxDelaySec) {
      pushToast({ kind: "error", title: t("broadcaster.antiBanSection"), body: t("broadcaster.minDelay") });
      return;
    }
    if (phase !== "live") {
      pushToast({ kind: "error", title: t(connectionLabelKey(phase)), body: t(connectionHintKey(phase)) });
      return;
    }
    setStarting(true);
    const result = await contentController.startCampaign({
      recipients: combined.recipients,
      message,
      attachment,
      settings,
    });
    setStarting(false);
    if (!result.ok) {
      pushToast({ kind: "error", title: result.error ?? t("errors.generic"), body: "" });
    }
  };

  const downloadReport = () => {
    const full = contentController.getCampaignRecipients();
    const source = full.length > 0 ? full : recipients;
    if (source.length === 0) {
      pushToast({ kind: "error", title: t("broadcaster.report"), body: t("broadcaster.noLogs") });
      return;
    }
    const csv = toCsv(
      ["phone", "name", "status", "reason", "chat_id"],
      source.map((recipient) => [recipient.phone, recipient.name, recipient.status, recipient.reason, recipient.chatId]),
    );
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    downloadText(`madarwa-campaign-${stamp}.csv`, csv, "text/csv;charset=utf-8");
  };

  const previewRecipient = combined.recipients[0];
  const previewText = personalizeMessage(message, {
    variables: {
      name: previewRecipient?.name ?? t("common.name"),
      custom1: previewRecipient?.custom1 ?? "",
      custom2: previewRecipient?.custom2 ?? "",
      phone: previewRecipient?.phone ?? "966500000000",
    },
    enableSpintax: settings.broadcaster.randomizeWithSpintax,
  });

  const isRunning = campaign.status === "running";
  const isPaused = campaign.status === "paused";
  const isFinished = campaign.status === "completed" || campaign.status === "stopped";
  const busy = isRunning || isPaused;
  const activeStep = busy ? 3 : step;
  const waiting = Boolean(campaign.waitingForConnection) && busy;
  const estimate = formatDuration(estimateCampaignSeconds(combined.recipients.length, settings.broadcaster), t);
  const statusLabel = waiting
    ? t("broadcaster.waitingConnection")
    : campaign.status === "running"
      ? t("status.running")
      : campaign.status === "paused"
        ? t("status.paused")
        : campaign.status === "completed"
          ? t("status.completed")
          : campaign.status === "stopped"
            ? t("broadcaster.stopped")
            : t("status.idle");

  const steps = [
    { id: 1, label: t("broadcaster.stepNumbers") },
    { id: 2, label: t("broadcaster.stepMessage") },
    { id: 3, label: t("broadcaster.stepSend") },
  ];

  const summary = `${t("broadcaster.summaryRecipients", {
    count: formatNumber(combined.recipients.length, settings.language),
  })}${message.trim() || attachment ? ` · ${t("broadcaster.summaryMessage")}` : ""}`;

  return (
    <div className="space-y-3">
      <SectionTitle
        icon={<Megaphone className="h-4 w-4" />}
        title={t("broadcaster.title")}
        subtitle={t("broadcaster.subtitle")}
        action={<Badge tone={waiting ? "warning" : statusTone(campaign.status)}>{statusLabel}</Badge>}
      />

      <Card className="p-2">
        <Stepper
          steps={steps}
          active={activeStep}
          onSelect={(id) => {
            if (!busy) setStep(id);
          }}
          ariaLabel={t("broadcaster.title")}
        />
        <p className="text-wa-muted mt-1.5 flex flex-wrap items-center gap-x-2 px-0.5 text-mw-xs leading-5">
          <span>{t("broadcaster.stepOf", { current: activeStep, total: 3 })}</span>
          <span aria-hidden="true">·</span>
          <span>{summary}</span>
        </p>
      </Card>

      {activeStep === 1 ? (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
            <h3 className="text-mw-sm font-semibold">{t("broadcaster.recipients")}</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="success">{t("broadcaster.parsedCount", { count: combined.recipients.length })}</Badge>
              {combined.invalid > 0 ? <Badge tone="danger">{t("broadcaster.invalidCount", { count: combined.invalid })}</Badge> : null}
              {combined.duplicates > 0 ? <Badge tone="warning">{t("broadcaster.duplicatesRemoved", { count: combined.duplicates })}</Badge> : null}
            </div>
          </div>
          <p className="text-wa-muted mb-2 text-mw-sm leading-5">{t("broadcaster.recipientsHint")}</p>
          <TextArea
            dir="ltr"
            className="mw-code min-h-[130px] text-left text-mw-sm"
            placeholder={t("broadcaster.numbersPlaceholder")}
            value={numbersText}
            onChange={(event) => setNumbersText(event.target.value)}
            disabled={busy}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label
              className={cn(
                "mw-card relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-mw-sm font-semibold transition-colors hover:bg-wa-hover focus-within:ring-2 focus-within:ring-wa-brand",
                (busy || fileBusy) && "pointer-events-none opacity-50",
              )}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {t("broadcaster.uploadCsv")}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="mw-sr-only"
                disabled={busy || fileBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleRecipientFile(file);
                }}
              />
            </label>
            {fileName ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-wa-input px-2 py-1 text-mw-xs font-semibold text-wa-text">
                <FileSpreadsheet className="h-3.5 w-3.5 text-wa-muted" aria-hidden="true" />
                {fileName} · {formatNumber(fileRecipients.length, settings.language)}
                <button
                  type="button"
                  aria-label={t("common.delete")}
                  onClick={() => {
                    setFileName("");
                    setFileRecipients([]);
                  }}
                  className="rounded p-0.5 hover:bg-wa-brand/15"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : null}
            {fileBusy ? <span className="text-wa-muted text-mw-xs">{t("common.loading")}</span> : null}
          </div>

          <div className="mt-3">
            <Field label={t("broadcaster.defaultCountry")} hint={t("broadcaster.defaultCountryHint")}>
              <TextInput
                dir="ltr"
                className="mw-code max-w-[140px] text-left"
                inputMode="numeric"
                placeholder="966"
                value={settings.broadcaster.defaultCountryCode}
                onChange={(event) => patchBroadcaster({ defaultCountryCode: event.target.value.replace(/\D/g, "").slice(0, 5) })}
                disabled={busy}
              />
            </Field>
          </div>

          <div className="mt-3 flex justify-end border-t border-wa-line pt-2.5">
            <Button size="sm" onClick={() => setStep(2)} disabled={combined.recipients.length === 0}>
              {t("common.next")}
            </Button>
          </div>
        </Card>
      ) : null}

      {activeStep === 2 ? (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-mw-sm font-semibold">{t("broadcaster.messageSection")}</h3>
            <Button variant="ghost" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setPreviewOpen(true)}>
              {t("broadcaster.preview")}
            </Button>
          </div>
          <TextArea
            dir="auto"
            placeholder={t("broadcaster.messagePlaceholder", { name: "{{name}}" })}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={4096}
            disabled={busy}
          />
          <p className="text-wa-muted mt-1.5 text-mw-xs leading-5">
            {t("broadcaster.variablesHint", {
              name: "{{name}}",
              custom1: "{{custom1}}",
              custom2: "{{custom2}}",
              phone: "{{phone}}",
            })}
          </p>
          <p className="text-wa-muted text-mw-xs leading-5">{t("broadcaster.spintaxHint")}</p>
          <div className="-mx-3 mt-1">
            <Toggle
              checked={settings.broadcaster.randomizeWithSpintax}
              onChange={(value) => patchBroadcaster({ randomizeWithSpintax: value })}
              label={t("broadcaster.enableSpintax")}
              disabled={busy}
            />
          </div>

          <div className="mt-3 rounded-lg border border-wa-line p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-mw-sm font-semibold">{t("broadcaster.attachment")}</p>
                <p className="text-wa-muted text-mw-xs leading-5">{t("broadcaster.attachmentHint")}</p>
              </div>
              <label
                className={cn(
                  "mw-card relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-mw-sm font-semibold transition-colors hover:bg-wa-hover focus-within:ring-2 focus-within:ring-wa-brand",
                  busy && "pointer-events-none opacity-50",
                )}
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {t("common.upload")}
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
                  className="mw-sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleAttachment(file);
                  }}
                />
              </label>
            </div>
            {attachment ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-wa-input px-2 py-2">
                {attachment.type === "image" || attachment.type === "sticker" ? (
                  <img src={attachment.dataUrl} alt="" className="h-10 w-10 rounded-md object-cover" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 text-wa-muted" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-mw-sm font-semibold">{t("broadcaster.attachmentSelected", { name: attachment.name })}</p>
                  <p className="text-wa-muted text-mw-2xs">{formatBytes(attachmentSize(attachment.dataUrl), settings.language)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="text-wa-muted rounded-lg p-1 hover:bg-wa-hover"
                  aria-label={t("broadcaster.removeAttachment")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-wa-line pt-2.5">
            <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
              {t("common.back")}
            </Button>
            <Button size="sm" onClick={() => setStep(3)} disabled={!message.trim() && !attachment}>
              {t("common.next")}
            </Button>
          </div>
        </Card>
      ) : null}

      {activeStep === 3 ? (
        <>
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-mw-sm font-semibold">{t("broadcaster.progress")}</h3>
              <div className="flex gap-1.5">
                {!busy ? (
                  <Button
                    size="sm"
                    loading={starting}
                    icon={<Play className="h-3.5 w-3.5" />}
                    onClick={() => void startCampaign()}
                    disabled={combined.recipients.length === 0 || (!message.trim() && !attachment)}
                  >
                    {t("broadcaster.start")}
                  </Button>
                ) : null}
                {isRunning && !validation.active && !waiting ? (
                  <Button variant="secondary" size="sm" icon={<Pause className="h-3.5 w-3.5" />} onClick={() => contentController.broadcast.pause()}>
                    {t("common.pause")}
                  </Button>
                ) : null}
                {isPaused && !validation.active && !waiting ? (
                  <Button variant="success" size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => contentController.broadcast.resume()}>
                    {t("common.resume")}
                  </Button>
                ) : null}
                {busy ? (
                  <Button variant="danger" size="sm" icon={<Square className="h-3.5 w-3.5" />} onClick={() => contentController.broadcast.stop()}>
                    {t("common.stop")}
                  </Button>
                ) : null}
                {isFinished ? (
                  <Button variant="ghost" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => contentController.broadcast.reset()}>
                    {t("common.clear")}
                  </Button>
                ) : null}
              </div>
            </div>

            {validation.active ? (
              <div className="mb-3 rounded-md border border-wa-brand/25 bg-wa-brand/10 px-3 py-2">
                <p className="text-mw-sm font-semibold text-wa-brand">
                  {t("broadcaster.validating", { current: formatNumber(validation.current, settings.language), total: formatNumber(validation.total, settings.language) })}
                </p>
                <Progress className="mt-2" value={validation.current} max={validation.total} label={t("broadcaster.progress")} />
              </div>
            ) : campaign.total > 0 ? (
              <>
                <div className="mb-2 flex items-center justify-between text-mw-xs">
                  <span className="text-wa-muted">{t("broadcaster.progress")}</span>
                  <span className="mw-lang-pill font-bold">
                    {formatNumber(campaign.processed, settings.language)} / {formatNumber(campaign.total, settings.language)}
                  </span>
                </div>
                <Progress value={campaign.processed} max={campaign.total} label={t("broadcaster.progress")} />
                <div className="mw-card mt-3 grid grid-cols-3">
                  <Stat label={t("broadcaster.sent")} value={formatNumber(campaign.sent, settings.language)} tone="success" />
                  <Stat label={t("broadcaster.failed")} value={formatNumber(campaign.failed, settings.language)} tone="danger" />
                  <Stat label={t("broadcaster.invalid")} value={formatNumber(campaign.invalid, settings.language)} tone="warning" />
                </div>
              </>
            ) : (
              <div className="flex items-start gap-2.5 rounded-md border border-wa-line px-3 py-2.5">
                <Send className="mt-0.5 h-4 w-4 shrink-0 text-wa-muted rtl:-scale-x-100" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-mw-sm font-semibold leading-5">{summary}</p>
                  {combined.recipients.length > 0 ? (
                    <p className="mt-0.5 text-mw-xs leading-5 text-wa-muted">{t("broadcaster.estimate", { duration: estimate })}</p>
                  ) : null}
                </div>
              </div>
            )}

            {campaign.logs.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="text-mw-xs font-semibold">{t("broadcaster.liveLog")}</h4>
                  <button
                    type="button"
                    onClick={downloadReport}
                    className="text-wa-muted inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-mw-xs font-semibold hover:bg-wa-hover hover:text-wa-text"
                  >
                    <Download className="h-3 w-3" />
                    {t("broadcaster.report")}
                  </button>
                </div>
                <div className="mw-scroll max-h-52 space-y-1 overflow-y-auto rounded-lg border border-wa-line bg-wa-input p-1.5">
                  {[...campaign.logs].reverse().slice(0, 60).map((log, index) => {
                    const entry = LOG_ICONS[log.status as keyof typeof LOG_ICONS] ?? LOG_ICONS.skipped;
                    const Icon = entry.icon;
                    return (
                      <div key={`${log.at}-${log.index}-${index}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-mw-xs">
                        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", entry.className)}>
                          <Icon className="h-3 w-3" aria-hidden="true" />
                          <span className="mw-sr-only">{t(entry.key)}</span>
                        </span>
                        {/* The number is the identifier, so it never truncates; the reason does. */}
                        <span className="mw-code shrink-0">{log.phone}</span>
                        <span className="text-wa-muted min-w-0 flex-1 truncate" title={log.status !== "sent" ? log.detail : undefined}>
                          {log.status !== "sent" ? log.detail : ""}
                        </span>
                        <span className="text-wa-muted mw-lang-pill shrink-0 text-mw-2xs">{formatTime(log.at, settings.language)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-3">
              <Alert tone="info">{t("broadcaster.senderNote")}</Alert>
            </div>

            {!busy ? (
              <div className="mt-3 flex justify-start border-t border-wa-line pt-2.5">
                <Button variant="secondary" size="sm" onClick={() => setStep(2)}>
                  {t("common.back")}
                </Button>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-mw-sm font-semibold">{t("broadcaster.antiBanSection")}</h3>
                <p className="text-wa-muted mt-0.5 text-mw-xs leading-5">
                  {t("broadcaster.antiBanSummary", {
                    min: settings.broadcaster.minDelaySec,
                    max: settings.broadcaster.maxDelaySec,
                    batch: settings.broadcaster.batchSize,
                    cooldown: settings.broadcaster.batchCooldownSec,
                  })}
                </p>
              </div>
              <ConfigureButton
                open={antiBanOpen}
                onClick={() => setAntiBanOpen((value) => !value)}
                label={t("common.configure")}
                title={t("broadcaster.advancedSettings")}
              />
            </div>
            <Disclosure open={antiBanOpen}>
              <div className="mt-2 grid grid-cols-2 gap-2.5">
                <Field label={t("broadcaster.minDelay")}>
                  <TextInput
                    type="number"
                    min={1}
                    max={600}
                    value={settings.broadcaster.minDelaySec}
                    onChange={(event) => setNumber("minDelaySec", event.target.value, 1, 600)}
                    disabled={busy}
                  />
                </Field>
                <Field label={t("broadcaster.maxDelay")}>
                  <TextInput
                    type="number"
                    min={1}
                    max={900}
                    value={settings.broadcaster.maxDelaySec}
                    onChange={(event) => setNumber("maxDelaySec", event.target.value, 1, 900)}
                    disabled={busy}
                  />
                </Field>
                <Field label={t("broadcaster.batchSize")} hint={t("broadcaster.batchSizeHint")}>
                  <TextInput
                    type="number"
                    min={1}
                    max={1000}
                    value={settings.broadcaster.batchSize}
                    onChange={(event) => setNumber("batchSize", event.target.value, 1, 1000)}
                    disabled={busy}
                  />
                </Field>
                <Field label={t("broadcaster.batchCooldown")}>
                  <TextInput
                    type="number"
                    min={0}
                    max={3600}
                    value={settings.broadcaster.batchCooldownSec}
                    onChange={(event) => setNumber("batchCooldownSec", event.target.value, 0, 3600)}
                    disabled={busy}
                  />
                </Field>
              </div>
              <div className="mt-1">
                <Toggle
                  checked={!settings.broadcaster.validateNumbers}
                  onChange={(value) => patchBroadcaster({ validateNumbers: !value })}
                  label={t("broadcaster.directSend")}
                  hint={t("broadcaster.directSendHint")}
                  disabled={busy}
                />
              </div>
            </Disclosure>
          </Card>
        </>
      ) : null}

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={t("broadcaster.previewTitle")}
        closeLabel={t("common.close")}
      >
        <p className="text-wa-muted mb-2 text-mw-sm leading-5">{t("broadcaster.previewHint")}</p>
        <div className="mw-chat-surface rounded-lg p-3 text-mw-sm text-wa-text">
          {previewText ? (
            <div className="mw-bubble-out ms-auto max-w-[85%] whitespace-pre-wrap rounded-lg rounded-te-sm px-3 py-2 leading-6" dir="auto">
              {previewText}
            </div>
          ) : null}
          {attachment ? (
            <div className="mw-bubble-out ms-auto mt-1 max-w-[85%] rounded-lg px-3 py-2 text-mw-xs">
              {attachment.type === "image" ? (
                <img src={attachment.dataUrl} alt="" className="max-h-40 rounded-lg" />
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="h-4 w-4" />
                  {attachment.name}
                </span>
              )}
            </div>
          ) : null}
          {!previewText && !attachment ? <p className="text-wa-muted text-center text-mw-sm">{t("broadcaster.noMessage")}</p> : null}
        </div>
        <p className="text-wa-muted mw-lang-pill mt-2 flex items-center justify-end gap-1 text-mw-2xs">
          {formatTime(Date.now(), settings.language)}
          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </p>
      </Modal>
    </div>
  );
}

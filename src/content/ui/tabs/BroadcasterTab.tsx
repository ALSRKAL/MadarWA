import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileSpreadsheet,
  ImageIcon,
  Megaphone,
  Pause,
  Play,
  RefreshCw,
  Send,
  Square,
  Upload,
  X,
} from "lucide-react";
import { readSheet } from "read-excel-file/browser";
import { UI_LIMITS } from "../../../shared/constants";
import { formatNumber, formatTime } from "../../../shared/format";
import { useAppStore, useSettings, useT } from "../../store";
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
  EmptyState,
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

export function BroadcasterTab() {
  const t = useT();
  const settings = useSettings();
  const setSettings = useAppStore((state) => state.setSettings);
  const pushToast = useAppStore((state) => state.pushToast);
  const campaign = useAppStore((state) => state.campaign);
  const recipients = useAppStore((state) => state.recipients);
  const validation = useAppStore((state) => state.validation);
  const bridgeConnected = useAppStore((state) => state.bridgeConnected);

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
          title: t("exporter.noData"),
          body: `Max ${UI_LIMITS.maxCampaignRecipients}`,
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
      pushToast({
        kind: "error",
        title: t("errors.generic"),
        body: error instanceof Error ? error.message.slice(0, 200) : "",
      });
    } finally {
      setFileBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAttachment = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) {
      pushToast({ kind: "error", title: t("broadcaster.longMessage"), body: "4 MB" });
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      return;
    }
    try {
      const next = await contentController.attachmentFromFile(file);
      if (attachmentSize(next.dataUrl) > 4 * 1024 * 1024) {
        pushToast({ kind: "error", title: t("broadcaster.longMessage"), body: "4 MB" });
        return;
      }
      setAttachment(next);
    } catch (error) {
      pushToast({
        kind: "error",
        title: t("errors.generic"),
        body: error instanceof Error ? error.message.slice(0, 200) : "",
      });
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
    if (!bridgeConnected) {
      pushToast({ kind: "error", title: t("errors.bridgeUnavailable"), body: "" });
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
  const statusLabel =
    campaign.status === "running"
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
        action={<Badge tone={statusTone(campaign.status)}>{statusLabel}</Badge>}
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
        <p className="text-wa-muted mt-1.5 flex flex-wrap items-center gap-x-2 px-0.5 text-[9.5px] leading-4">
          <span>{t("broadcaster.stepOf", { current: activeStep, total: 3 })}</span>
          <span aria-hidden="true">·</span>
          <span>{summary}</span>
        </p>
      </Card>

      {activeStep === 1 ? (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
            <h3 className="text-[11px] font-semibold">{t("broadcaster.recipients")}</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="success">{t("broadcaster.parsedCount", { count: combined.recipients.length })}</Badge>
              {combined.invalid > 0 ? <Badge tone="danger">{t("broadcaster.invalidCount", { count: combined.invalid })}</Badge> : null}
              {combined.duplicates > 0 ? <Badge tone="warning">{t("broadcaster.duplicatesRemoved", { count: combined.duplicates })}</Badge> : null}
            </div>
          </div>
          <p className="text-wa-muted mb-2 text-[11px] leading-5">{t("broadcaster.recipientsHint")}</p>
          <TextArea
            dir="ltr"
            className="mw-code min-h-[130px] text-left text-[12px]"
            placeholder={t("broadcaster.numbersPlaceholder")}
            value={numbersText}
            onChange={(event) => setNumbersText(event.target.value)}
            disabled={busy}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label
              className={cn(
                "mw-card inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition-colors hover:bg-wa-hover",
                (busy || fileBusy) && "pointer-events-none opacity-50",
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              {t("broadcaster.uploadCsv")}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleRecipientFile(file);
                }}
              />
            </label>
            {fileName ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-wa-brand/10 px-2 py-1 text-[10px] font-semibold text-wa-brand">
                <FileSpreadsheet className="h-3 w-3" />
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
            {fileBusy ? <span className="text-wa-muted text-[10px]">{t("common.loading")}</span> : null}
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
            <h3 className="text-[11px] font-semibold">{t("broadcaster.messageSection")}</h3>
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
          <p className="text-wa-muted mt-1.5 text-[10.5px] leading-5">
            {t("broadcaster.variablesHint", {
              name: "{{name}}",
              custom1: "{{custom1}}",
              custom2: "{{custom2}}",
              phone: "{{phone}}",
            })}
          </p>
          <p className="text-wa-muted text-[10.5px] leading-5">{t("broadcaster.spintaxHint")}</p>
          <div className="mt-1">
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
                <p className="text-[11px] font-semibold">{t("broadcaster.attachment")}</p>
                <p className="text-wa-muted text-[10px] leading-5">{t("broadcaster.attachmentHint")}</p>
              </div>
              <label
                className={cn(
                  "mw-card inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition-colors hover:bg-wa-hover",
                  busy && "pointer-events-none opacity-50",
                )}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                {t("common.upload")}
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleAttachment(file);
                  }}
                />
              </label>
            </div>
            {attachment ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-wa-brand/10 px-2 py-2">
                {attachment.type === "image" || attachment.type === "sticker" ? (
                  <img src={attachment.dataUrl} alt="" className="h-10 w-10 rounded-md object-cover" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 text-wa-brand" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold">{t("broadcaster.attachmentSelected", { name: attachment.name })}</p>
                  <p className="text-wa-muted mw-lang-pill text-[9px]">{Math.ceil(attachmentSize(attachment.dataUrl) / 1024)} KB</p>
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
              <h3 className="text-[11px] font-semibold">{t("broadcaster.progress")}</h3>
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
                {isRunning && !validation.active ? (
                  <Button variant="secondary" size="sm" icon={<Pause className="h-3.5 w-3.5" />} onClick={() => contentController.broadcast.pause()}>
                    {t("common.pause")}
                  </Button>
                ) : null}
                {isPaused && !validation.active ? (
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
                <p className="text-[11px] font-semibold text-wa-brand">
                  {t("broadcaster.validating", { current: formatNumber(validation.current, settings.language), total: formatNumber(validation.total, settings.language) })}
                </p>
                <Progress className="mt-2" value={validation.current} max={validation.total} striped />
              </div>
            ) : campaign.total > 0 ? (
              <>
                <div className="mb-2 flex items-center justify-between text-[10.5px]">
                  <span className="text-wa-muted">{t("broadcaster.progress")}</span>
                  <span className="mw-lang-pill font-bold">
                    {formatNumber(campaign.processed, settings.language)} / {formatNumber(campaign.total, settings.language)}
                  </span>
                </div>
                <Progress value={campaign.processed} max={campaign.total} striped={isRunning} />
                <div className="mw-card mt-3 grid grid-cols-3">
                  <Stat label={t("broadcaster.sent")} value={formatNumber(campaign.sent, settings.language)} tone="success" />
                  <Stat label={t("broadcaster.failed")} value={formatNumber(campaign.failed, settings.language)} tone="danger" />
                  <Stat label={t("broadcaster.invalid")} value={formatNumber(campaign.invalid, settings.language)} tone="warning" />
                </div>
              </>
            ) : (
              <EmptyState title={t("broadcaster.noLogs")} body={t("broadcaster.senderNote")} icon={<Send className="h-8 w-8" />} />
            )}

            {campaign.logs.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="text-[10.5px] font-semibold">{t("broadcaster.liveLog")}</h4>
                  <button
                    type="button"
                    onClick={downloadReport}
                    className="text-wa-muted inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold hover:bg-wa-hover hover:text-wa-text"
                  >
                    <Download className="h-3 w-3" />
                    {t("broadcaster.report")}
                  </button>
                </div>
                <div className="mw-scroll max-h-52 space-y-1 overflow-y-auto rounded-lg border border-wa-line bg-wa-input p-1.5">
                  {[...campaign.logs].reverse().slice(0, 60).map((log, index) => (
                    <div key={`${log.at}-${log.index}-${index}`} className="flex items-start gap-2 rounded-lg px-1.5 py-1 text-[10px]">
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold",
                          log.status === "sent"
                            ? "bg-wa-brand/15 text-wa-brand"
                            : log.status === "invalid"
                              ? "bg-wa-warning/15 text-wa-warning"
                              : log.status === "failed"
                                ? "bg-wa-danger/15 text-wa-danger"
                                : "bg-wa-muted/15 text-wa-muted",
                        )}
                      >
                        {log.status === "sent" ? "✓" : log.status === "failed" ? "!" : log.status === "invalid" ? "?" : "–"}
                      </span>
                      <span className="mw-code min-w-0 flex-1 truncate text-[10px]">{log.phone}</span>
                      <span className="text-wa-muted max-w-[45%] truncate text-[9px]">{log.detail}</span>
                      <span className="text-wa-muted mw-lang-pill shrink-0 text-[9px]">{formatTime(log.at, settings.language)}</span>
                    </div>
                  ))}
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
                <h3 className="text-[11px] font-semibold">{t("broadcaster.antiBanSection")}</h3>
                <p className="text-wa-muted mw-lang-pill mt-0.5 text-[9.5px]">
                  {settings.broadcaster.minDelaySec}–{settings.broadcaster.maxDelaySec}s · {settings.broadcaster.batchSize} /{" "}
                  {settings.broadcaster.batchCooldownSec}s
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
        <p className="text-wa-muted mb-2 text-[11px] leading-5">{t("broadcaster.previewHint")}</p>
        <div className="rounded-lg bg-[#0b141a] p-3 text-[12px] text-wa-text">
          {previewText ? (
            <div className="ms-auto max-w-[85%] rounded-lg rounded-te-sm bg-[#005c4b] px-3 py-2 leading-6 whitespace-pre-wrap">{previewText}</div>
          ) : null}
          {attachment ? (
            <div className="ms-auto mt-1 max-w-[85%] rounded-lg bg-[#005c4b] px-3 py-2 text-[11px]">
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
          {!previewText && !attachment ? <p className="text-wa-muted text-center text-[11px]">{t("broadcaster.noMessage")}</p> : null}
        </div>
        <p className="text-wa-muted mw-lang-pill mt-2 text-end text-[9px]">{formatTime(Date.now(), settings.language)} ✓✓</p>
      </Modal>
    </div>
  );
}

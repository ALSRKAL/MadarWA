import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Inbox,
  Play,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { describeError } from "../../../shared/errors";
import { formatDateTime, formatNumber } from "../../../shared/format";
import { MediaVaultCache, type MediaVaultRecord } from "../../../shared/media-vault";
import { saveVault } from "../../../shared/storage";
import type { AntiDeleteSettings, DeletedMessage, InlineRestoreMode } from "../../../shared/types";
import {
  extensionForMimetype,
  formatBytes,
  normalizeMediaKind,
  type MediaKind,
} from "../../../shared/utils/media";
import { contentController } from "../../controller";
import { useAppStore, useSettings, useT } from "../../store";
import {
  Badge,
  Button,
  Card,
  ConfigureButton,
  CopyButton,
  Disclosure,
  EmptyState,
  Field,
  FilterChips,
  Modal,
  NumberInput,
  SectionTitle,
  Select,
  TextInput,
  Toggle,
} from "../components";

const mediaVault = new MediaVaultCache();

type VaultFilter = "all" | "text" | "photo" | "video" | "audio";

function kindOf(entry: DeletedMessage): MediaKind | "" {
  return normalizeMediaKind(entry.mediaType || entry.messageType || "");
}

function filterOf(entry: DeletedMessage): Exclude<VaultFilter, "all"> {
  const kind = kindOf(entry);
  if (kind === "image" || kind === "sticker") return "photo";
  if (kind === "video") return "video";
  if (kind === "ptt" || kind === "audio") return "audio";
  return "text";
}

function mediaFilename(entry: DeletedMessage, record: MediaVaultRecord | null, kind: MediaKind | ""): string {
  const provided = record?.filename || entry.filename || "";
  const cleaned = provided.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 120);
  if (cleaned) return cleaned;
  const extension = extensionForMimetype(record?.mimetype || entry.mimetype || "", kind === "image" ? "jpg" : "bin");
  return `madarwa-${(entry.stanzaId || entry.id || "media").replace(/[^\w.-]+/g, "_")}.${extension}`;
}

function VaultMedia({ entry }: { entry: DeletedMessage }) {
  const t = useT();
  const language = useSettings().language;
  const kind = kindOf(entry);
  const [url, setUrl] = useState("");
  const [record, setRecord] = useState<MediaVaultRecord | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setUrl("");
    setRecord(null);
    if (!kind) return;
    void (async () => {
      const found =
        (await mediaVault.get(entry.id)) ??
        (entry.stanzaId ? await mediaVault.get(entry.stanzaId) : null);
      if (cancelled || !found) return;
      objectUrl = URL.createObjectURL(found.blob);
      setRecord(found);
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.id, entry.stanzaId, kind, entry.hasFullMedia]);

  if (!kind) return null;

  const filename = mediaFilename(entry, record, kind);
  const size = record?.fileSize || entry.fileSize || 0;
  const preview = entry.previewDataUrl || "";
  const downloadLabel = t("vault.downloadMedia");

  const downloadLink = url ? (
    <a className="mw-btn mw-btn-secondary mw-btn-sm" href={url} download={filename}>
      <Download className="h-3 w-3" />
      {downloadLabel}
    </a>
  ) : null;

  if (kind === "image" || kind === "sticker") {
    const source = url || preview;
    return (
      <div className="mt-2">
        {source ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group relative block overflow-hidden rounded-md border border-wa-line"
            aria-label={t("vault.previewMedia")}
          >
            <img
              src={source}
              alt={t("vault.previewMedia")}
              className="max-h-40 max-w-full cursor-zoom-in object-cover"
              loading="lazy"
            />
            {url ? (
              <span className="mw-media-overlay absolute bottom-1 end-1 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            ) : null}
          </button>
        ) : (
          <div className="rounded-md bg-wa-input/50 px-2.5 py-2">
            <Badge tone="neutral">{t("media.image")}</Badge>
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-1.5">
          <Badge tone={url ? "success" : "neutral"}>
            {url ? t("vault.mediaReady") : t("vault.mediaPreviewOnly")}
          </Badge>
          {downloadLink}
        </div>
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={t("vault.previewMedia")}
          closeLabel={t("common.close")}
          footer={downloadLink}
        >
          {source ? (
            <img src={source} alt={t("vault.previewMedia")} className="max-h-[56vh] w-full rounded-md object-contain" />
          ) : null}
        </Modal>
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="mt-2">
        {url ? (
          <video
            src={url}
            controls
            preload="metadata"
            className="mw-media-frame max-h-48 w-full max-w-sm rounded-md"
          />
        ) : preview ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative block overflow-hidden rounded-md border border-wa-line"
            aria-label={t("vault.previewMedia")}
          >
            <img src={preview} alt={t("media.video")} className="max-h-40 max-w-full object-cover" />
            <span className="mw-media-overlay absolute inset-0 m-auto flex h-9 w-9 items-center justify-center rounded-full">
              <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
            </span>
          </button>
        ) : (
          <Badge tone="neutral">{t("media.video")}</Badge>
        )}
        <div className="mt-1.5 flex items-center gap-1.5">
          <Badge tone={url ? "success" : "neutral"}>
            {url ? t("vault.mediaReady") : t("vault.mediaPreviewOnly")}
          </Badge>
          {downloadLink}
        </div>
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={t("vault.previewMedia")}
          closeLabel={t("common.close")}
          footer={downloadLink}
        >
          {preview ? <img src={preview} alt={t("media.video")} className="max-h-[56vh] w-full rounded-md object-contain" /> : null}
        </Modal>
      </div>
    );
  }

  if (kind === "ptt" || kind === "audio") {
    return (
      <div className="mt-2 space-y-1.5">
        {url ? (
          <audio src={url} controls preload="metadata" className="h-8 w-full max-w-xs" />
        ) : (
          <Badge tone="neutral">{kind === "ptt" ? t("media.ptt") : t("media.audio")}</Badge>
        )}
        <div className="flex items-center gap-1.5">
          <Badge tone={url ? "success" : "neutral"}>
            {url ? t("vault.mediaReady") : t("vault.mediaPreviewOnly")}
          </Badge>
          {downloadLink}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-wa-line px-2.5 py-2">
      <FileText className="h-4 w-4 shrink-0 text-wa-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-mw-sm font-semibold">{filename}</p>
        <p className="text-wa-muted text-mw-2xs">{size > 0 ? formatBytes(size, language) : t("media.document")}</p>
      </div>
      {downloadLink}
    </div>
  );
}

export function VaultTab() {
  const t = useT();
  const settings = useSettings();
  const setSettings = useAppStore((state) => state.setSettings);
  const vault = useAppStore((state) => state.vault);
  const clearVault = useAppStore((state) => state.clearVault);
  const pushToast = useAppStore((state) => state.pushToast);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VaultFilter>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [openingId, setOpeningId] = useState("");

  const patchAntiDelete = (patch: Partial<AntiDeleteSettings>) => {
    setSettings({ ...settings, antiDelete: { ...settings.antiDelete, ...patch } });
  };

  const counts = useMemo(() => {
    const result: Record<VaultFilter, number> = { all: vault.length, text: 0, photo: 0, video: 0, audio: 0 };
    for (const entry of vault) result[filterOf(entry)] += 1;
    return result;
  }, [vault]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vault.filter((entry) => {
      if (filter !== "all" && filterOf(entry) !== filter) return false;
      if (!query) return true;
      return [entry.text, entry.caption, entry.chatName, entry.sender, entry.senderName, entry.revokedBy, entry.chatId]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [filter, search, vault]);

  const mediaLabel = (entry: DeletedMessage): string => {
    const kind = kindOf(entry);
    if (kind === "image") return t("media.image");
    if (kind === "video") return t("media.video");
    if (kind === "ptt") return t("media.ptt");
    if (kind === "audio") return t("media.audio");
    if (kind === "sticker") return t("media.sticker");
    if (kind === "document") return t("media.document");
    return t("media.text");
  };

  const openChat = async (entry: DeletedMessage) => {
    if (!entry.chatId || openingId) return;
    setOpeningId(entry.id);
    try {
      await contentController.openChat(entry.chatId);
      pushToast({ kind: "success", title: t("vault.chatOpened"), body: entry.chatName });
    } catch (error) {
      const { title, detail } = describeError(error, t);
      pushToast({ kind: "error", title, body: detail });
    } finally {
      setOpeningId("");
    }
  };

  // Persist first: the list is only emptied once storage confirmed the write,
  // so a failed save never shows "cleared" while the data is still there.
  const confirmClear = async () => {
    setClearing(true);
    try {
      const saved = await saveVault([]);
      if (!saved) {
        pushToast({ kind: "error", title: t("errors.saveFailed"), body: "" });
        return;
      }
      await mediaVault.clear();
      clearVault();
      setClearOpen(false);
      pushToast({ kind: "info", title: t("vault.cleared"), body: "" });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-3">
      <SectionTitle
        icon={<ShieldAlert className="h-4 w-4" />}
        title={t("vault.title")}
        subtitle={t("vault.subtitle")}
        action={<Badge tone="neutral">{t("vault.count", { count: formatNumber(vault.length, settings.language) })}</Badge>}
      />

      <Card className="p-0">
        <Toggle
          checked={settings.antiDelete.enabled}
          onChange={(value) => patchAntiDelete({ enabled: value })}
          label={t("vault.enable")}
          hint={t("vault.enableHint")}
        />
        <Toggle
          checked={settings.antiDelete.inlineRestore}
          onChange={(value) => patchAntiDelete({ inlineRestore: value })}
          label={t("vault.inlineRestore")}
          hint={settings.antiDelete.inlineRestore ? t("vault.inlineRestoreHint") : undefined}
          disabled={!settings.antiDelete.enabled}
          action={
            settings.antiDelete.enabled ? (
              <ConfigureButton
                open={settingsOpen}
                onClick={() => setSettingsOpen((value) => !value)}
                label={t("common.configure")}
                title={t("vault.settingsAdvanced")}
              />
            ) : undefined
          }
        />
        <Disclosure open={settingsOpen && settings.antiDelete.enabled}>
          <div className="space-y-2">
            <Toggle
              checked={settings.antiDelete.inChatToast}
              onChange={(value) => patchAntiDelete({ inChatToast: value })}
              label={t("vault.toast")}
            />
            <Toggle
              checked={settings.antiDelete.desktopNotification}
              onChange={(value) => patchAntiDelete({ desktopNotification: value })}
              label={t("vault.desktop")}
            />
            <Field label={t("vault.inlineMode")} hint={t("vault.inlineModeHint")}>
              <Select
                value={settings.antiDelete.inlineMode}
                onChange={(event) => patchAntiDelete({ inlineMode: event.target.value as InlineRestoreMode })}
                disabled={!settings.antiDelete.inlineRestore}
              >
                <option value="interactive">{t("vault.modeInteractive")}</option>
                <option value="expanded">{t("vault.modeExpanded")}</option>
              </Select>
            </Field>
            <Field label={t("vault.maxCache")}>
              <NumberInput
                min={50}
                max={3000}
                value={settings.antiDelete.maxCache}
                onCommit={(value) => patchAntiDelete({ maxCache: value })}
              />
            </Field>
          </div>
        </Disclosure>
      </Card>

      <div className="relative">
        <Search className="absolute inset-y-0 start-3 my-auto h-4 w-4 text-wa-muted" />
        <TextInput
          type="search"
          className="bg-wa-surface ps-9"
          placeholder={t("vault.search")}
          aria-label={t("vault.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-wa-muted absolute inset-y-0 end-2 my-auto h-7 rounded px-2 text-mw-xs hover:bg-wa-hover"
          >
            {t("common.clear")}
          </button>
        ) : null}
      </div>

      <FilterChips
        ariaLabel={t("vault.title")}
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: t("vault.filterAll"), count: counts.all },
          { id: "text", label: t("vault.filterText"), count: counts.text },
          { id: "photo", label: t("vault.filterPhotos"), count: counts.photo },
          { id: "video", label: t("vault.filterVideos"), count: counts.video },
          { id: "audio", label: t("vault.filterAudio"), count: counts.audio },
        ]}
      />

      {vault.length === 0 ? (
        <EmptyState icon={<Inbox className="h-6 w-6" />} title={t("vault.empty")} body={t("vault.emptyHint")} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search className="h-5 w-5" />} title={t("common.noResults")} />
      ) : (
        <div className="mw-card divide-y divide-wa-line">
          {filtered.map((entry) => (
            <div key={entry.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-mw-sm font-semibold">{entry.chatName || entry.chatId}</p>
                    <Badge tone="neutral">{entry.isGroup ? t("vault.group") : t("vault.private")}</Badge>
                    {entry.recoveredFromCache ? <Badge tone="success">{t("vault.recovered")}</Badge> : null}
                    {kindOf(entry) ? <Badge tone="neutral">{mediaLabel(entry)}</Badge> : null}
                  </div>
                  <div className="text-wa-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-mw-xs">
                    <span>
                      {t("vault.sender")}: {entry.senderName || entry.sender || entry.revokedBy || t("common.unknown")}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t("vault.deletedAt")}: {formatDateTime(entry.revokedAt, settings.language)}
                    </span>
                  </div>
                </div>
                <span
                  className="text-wa-muted mw-lang-pill shrink-0 text-mw-2xs"
                  title={t("vault.originalTime")}
                  aria-label={`${t("vault.originalTime")}: ${formatDateTime(entry.timestamp, settings.language)}`}
                >
                  {formatDateTime(entry.timestamp, settings.language)}
                </span>
              </div>

              {entry.text ? (
                <p className="mt-2 whitespace-pre-wrap break-words border-s-2 border-wa-line ps-2.5 text-mw-sm leading-6" dir="auto">
                  {entry.text}
                </p>
              ) : null}

              <VaultMedia entry={entry} />

              {!entry.text && !kindOf(entry) ? (
                <div className="mt-2 rounded-sm bg-wa-input/50 px-2.5 py-2">
                  <Badge tone="neutral">{mediaLabel(entry)}</Badge>
                  {!entry.recoveredFromCache ? (
                    <p className="text-wa-muted mt-1 text-mw-xs leading-5">{t("vault.notCached")}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-2 flex items-center justify-between gap-1 border-t border-wa-line pt-1.5">
                <span className="text-wa-muted mw-code truncate text-mw-2xs" dir="ltr">
                  {entry.revokedBy || ""}
                </span>
                <div className="flex items-center gap-1">
                  {entry.text ? <CopyButton text={entry.text} label={t("vault.copyText")} copiedLabel={t("common.copied")} /> : null}
                  {entry.chatId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
                      loading={openingId === entry.id}
                      disabled={openingId !== ""}
                      onClick={() => void openChat(entry)}
                    >
                      {t("vault.openChat")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {vault.length > 0 ? (
        <div className="flex justify-end">
          <Button variant="dangerGhost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setClearOpen(true)}>
            {t("vault.clearAll")}
          </Button>
        </div>
      ) : null}

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title={t("vault.clearAll")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setClearOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" size="sm" loading={clearing} onClick={() => void confirmClear()}>
              {t("vault.clearAll")}
            </Button>
          </>
        }
      >
        <p className="text-mw-sm leading-6">{t("vault.clearConfirm")}</p>
      </Modal>
    </div>
  );
}

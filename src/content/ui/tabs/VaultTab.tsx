import { useMemo, useState } from "react";
import { ExternalLink, Inbox, Search, ShieldAlert, Trash2 } from "lucide-react";
import { formatDateTime, formatNumber } from "../../../shared/format";
import { saveVault } from "../../../shared/storage";
import type { AntiDeleteSettings, DeletedMessage } from "../../../shared/types";
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
  Modal,
  SectionTitle,
  TextInput,
  Toggle,
} from "../components";

export function VaultTab() {
  const t = useT();
  const settings = useSettings();
  const setSettings = useAppStore((state) => state.setSettings);
  const vault = useAppStore((state) => state.vault);
  const clearVault = useAppStore((state) => state.clearVault);
  const pushToast = useAppStore((state) => state.pushToast);

  const [search, setSearch] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const patchAntiDelete = (patch: Partial<AntiDeleteSettings>) => {
    setSettings({ ...settings, antiDelete: { ...settings.antiDelete, ...patch } });
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return vault;
    return vault.filter((entry) =>
      [entry.text, entry.chatName, entry.sender, entry.senderName, entry.revokedBy, entry.chatId]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search, vault]);

  const mediaLabel = (entry: DeletedMessage): string => {
    const type = entry.messageType.toLowerCase();
    if (type === "chat" || type === "text") return t("media.text");
    if (type.includes("image")) return t("media.image");
    if (type.includes("video")) return t("media.video");
    if (type === "ptt") return t("media.ptt");
    if (type.includes("audio")) return t("media.audio");
    if (type.includes("sticker")) return t("media.sticker");
    if (type.includes("document")) return t("media.document");
    return t("media.other");
  };

  const openChat = async (entry: DeletedMessage) => {
    if (!entry.chatId) return;
    try {
      await contentController.openChat(entry.chatId);
      pushToast({ kind: "success", title: t("vault.openChat"), body: entry.chatName });
    } catch (error) {
      pushToast({
        kind: "error",
        title: t("errors.bridgeUnavailable"),
        body: error instanceof Error ? error.message.slice(0, 180) : "",
      });
    }
  };

  const confirmClear = async () => {
    setClearing(true);
    clearVault();
    await saveVault([]);
    setClearing(false);
    setClearOpen(false);
    pushToast({ kind: "info", title: t("vault.cleared"), body: "" });
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        icon={<ShieldAlert className="h-4 w-4" />}
        title={t("vault.title")}
        subtitle={t("vault.subtitle")}
        action={<Badge tone={vault.length > 0 ? "danger" : "neutral"}>{t("vault.count", { count: formatNumber(vault.length, settings.language) })}</Badge>}
      />

      <Card className="p-1.5">
        <Toggle
          checked={settings.antiDelete.enabled}
          onChange={(value) => patchAntiDelete({ enabled: value })}
          label={t("vault.enable")}
          hint={t("vault.enableHint")}
        />
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
        <div className="px-1.5 pb-1.5 pt-1">
          <Field label={t("vault.maxCache")}>
            <TextInput
              type="number"
              min={50}
              max={3000}
              value={settings.antiDelete.maxCache}
              onChange={(event) => {
                const value = Math.min(3000, Math.max(50, Number(event.target.value) || 800));
                patchAntiDelete({ maxCache: value });
              }}
            />
          </Field>
        </div>
      </Card>

      <div className="relative">
        <Search className="absolute inset-y-0 start-3 my-auto h-4 w-4 text-[color:var(--mw-muted)]" />
        <TextInput
          className="ps-9"
          placeholder={t("vault.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="mw-muted absolute inset-y-0 end-2 my-auto h-6 rounded px-1.5 text-[10px] hover:bg-[color:var(--mw-hover)]"
          >
            {t("common.clear")}
          </button>
        ) : null}
      </div>

      {vault.length === 0 ? (
        <EmptyState icon={<Inbox className="h-9 w-9" />} title={t("vault.empty")} body={t("vault.emptyHint")} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search className="h-8 w-8" />} title={t("common.noResults")} />
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <Card key={entry.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-[12px] font-bold">{entry.chatName || entry.chatId}</p>
                    <Badge tone={entry.isGroup ? "brand" : "neutral"}>{entry.isGroup ? t("vault.group") : t("vault.private")}</Badge>
                    {entry.recoveredFromCache ? <Badge tone="success">{t("vault.recovered")}</Badge> : null}
                  </div>
                  <div className="mw-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px]">
                    <span>{formatDateTime(entry.revokedAt, settings.language)}</span>
                    <span>·</span>
                    <span>
                      {t("vault.sender")}: {entry.senderName || entry.sender || entry.revokedBy || t("common.unknown")}
                    </span>
                  </div>
                </div>
                <span className="mw-muted mw-lang-pill shrink-0 text-[9px]">{formatDateTime(entry.timestamp, settings.language)}</span>
              </div>

              {entry.text ? (
                <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[color:var(--mw-input)] px-2.5 py-2 text-[11.5px] leading-6">
                  {entry.text}
                </p>
              ) : (
                <div className="mt-2 rounded-xl border border-dashed border-[color:var(--mw-border)] px-2.5 py-2">
                  <Badge tone="neutral">{mediaLabel(entry)}</Badge>
                  {!entry.recoveredFromCache ? (
                    <p className="mw-muted mt-1 text-[10px] leading-5">{t("vault.notCached")}</p>
                  ) : null}
                </div>
              )}

              <div className="mt-2 flex items-center justify-between gap-1 border-t border-[color:var(--mw-border)] pt-1.5">
                <span className="mw-muted mw-code truncate text-[9px]" dir="ltr">
                  {entry.revokedBy || ""}
                </span>
                <div className="flex items-center gap-1">
                  {entry.text ? <CopyButton text={entry.text} label={t("vault.copyText")} copiedLabel={t("common.copied")} /> : null}
                  <button
                    type="button"
                    onClick={() => void openChat(entry)}
                    className="mw-muted inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold transition-colors hover:bg-[color:var(--mw-hover)] hover:text-[color:var(--mw-text)]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("vault.openChat")}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {vault.length > 0 ? (
        <div className="flex justify-end">
          <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setClearOpen(true)}>
            {t("vault.clearAll")}
          </Button>
        </div>
      ) : null}

      <Alert tone="info">{t("vault.emptyHint")}</Alert>

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
        <p className="text-[12px] leading-6">{t("vault.clearConfirm")}</p>
      </Modal>
    </div>
  );
}

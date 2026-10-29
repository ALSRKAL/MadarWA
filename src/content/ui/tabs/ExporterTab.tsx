import { useEffect, useMemo, useRef, useState } from "react";
import { FileJson, FileSpreadsheet, RefreshCw, Search } from "lucide-react";
import { BRIDGE_COMMANDS } from "../../../shared/constants";
import { describeError } from "../../../shared/errors";
import { formatNumber } from "../../../shared/format";
import { downloadText } from "../../../shared/storage";
import type { ContactRow, GroupParticipantRow, GroupSummary } from "../../../shared/types";
import { toCsv, toJson } from "../../../shared/utils/csv";
import { contentController } from "../../controller";
import { useAppStore, useSettings, useT } from "../../store";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  SectionTitle,
  Select,
  TextInput,
  Toggle,
  cn,
} from "../components";

type Source = "groupMembers" | "contacts" | "chats";
type ExportRow = ContactRow | GroupParticipantRow;

function isParticipant(row: ExportRow): row is GroupParticipantRow {
  return "isAdmin" in row;
}

export function ExporterTab() {
  const t = useT();
  const settings = useSettings();
  const bridgeConnected = useAppStore((state) => state.bridgeConnected);
  const pushToast = useAppStore((state) => state.pushToast);

  const [source, setSource] = useState<Source>("groupMembers");
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [onlyMyContacts, setOnlyMyContacts] = useState(true);
  const [excludeAdmins, setExcludeAdmins] = useState(false);
  const [onlyUnsaved, setOnlyUnsaved] = useState(false);
  const [countryCode, setCountryCode] = useState("");
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [hasExtracted, setHasExtracted] = useState(false);
  const requestedGroups = useRef(false);

  const loadGroups = async () => {
    if (!bridgeConnected) {
      pushToast({ kind: "error", title: t("errors.bridgeUnavailable"), body: "" });
      return;
    }
    setLoadingGroups(true);
    try {
      const result = await contentController.request<{ groups: GroupSummary[] }>(
        BRIDGE_COMMANDS.listGroups,
        {},
        120_000,
      );
      setGroups(result.groups);
      if (!selectedGroup && result.groups[0]) setSelectedGroup(result.groups[0].id);
      if (result.groups.length === 0) {
        pushToast({ kind: "info", title: t("exporter.noGroups"), body: "" });
      }
    } catch (error) {
      const { title, detail } = describeError(error, t);
      pushToast({ kind: "error", title, body: detail });
    } finally {
      setLoadingGroups(false);
    }
  };

  useEffect(() => {
    if (source !== "groupMembers" || requestedGroups.current || !bridgeConnected) return;
    requestedGroups.current = true;
    void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeConnected, source]);

  useEffect(() => {
    setRows([]);
    setHasExtracted(false);
  }, [source]);

  const extract = async () => {
    if (!bridgeConnected) {
      pushToast({ kind: "error", title: t("errors.bridgeUnavailable"), body: "" });
      return;
    }
    if (source === "groupMembers" && !selectedGroup) {
      pushToast({ kind: "error", title: t("exporter.selectGroup"), body: "" });
      return;
    }
    setExtracting(true);
    // Never show the previous source's rows under a new extraction.
    setRows([]);
    setHasExtracted(false);
    try {
      if (source === "groupMembers") {
        const result = await contentController.request<{ participants: GroupParticipantRow[] }>(
          BRIDGE_COMMANDS.groupParticipants,
          { groupId: selectedGroup },
          180_000,
        );
        setRows(result.participants);
      } else if (source === "contacts") {
        const result = await contentController.request<{ contacts: ContactRow[] }>(
          BRIDGE_COMMANDS.listContacts,
          { onlyMyContacts },
          120_000,
        );
        setRows(result.contacts);
      } else {
        const result = await contentController.request<{ chats: ContactRow[] }>(
          BRIDGE_COMMANDS.listChats,
          {},
          120_000,
        );
        setRows(result.chats);
      }
      setHasExtracted(true);
    } catch (error) {
      const { title, detail } = describeError(error, t);
      pushToast({ kind: "error", title, body: detail });
    } finally {
      setExtracting(false);
    }
  };

  const notifyExport = (saved: boolean, count: number) =>
    pushToast(
      saved
        ? { kind: "success", title: t("exporter.exported", { count: formatNumber(count, settings.language) }), body: "" }
        : { kind: "error", title: t("errors.generic"), body: "" },
    );

  const filtered = useMemo(() => {
    const code = countryCode.replace(/\D/g, "");
    return rows.filter((row) => {
      if (excludeAdmins && isParticipant(row) && row.isAdmin) return false;
      if (onlyUnsaved && row.isMyContact) return false;
      if (code && !row.phone.startsWith(code)) return false;
      return true;
    });
  }, [countryCode, excludeAdmins, onlyUnsaved, rows]);

  const exportCsv = () => {
    if (filtered.length === 0) {
      pushToast({ kind: "error", title: t("exporter.noData"), body: "" });
      return;
    }
    const withGroup = source === "groupMembers";
    const headers = withGroup
      ? ["phone", "formatted_phone", "name", "group", "is_admin", "is_super_admin", "is_my_contact", "chat_id"]
      : ["phone", "formatted_phone", "name", "is_my_contact", "chat_id"];
    const data = filtered.map((row) =>
      withGroup && isParticipant(row)
        ? [row.phone, row.formattedPhone, row.name, row.groupName, row.isAdmin ? "yes" : "no", row.isSuperAdmin ? "yes" : "no", row.isMyContact ? "yes" : "no", row.id]
        : [row.phone, row.formattedPhone, row.name, row.isMyContact ? "yes" : "no", row.id],
    );
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    notifyExport(downloadText(`madarwa-${source}-${stamp}.csv`, toCsv(headers, data), "text/csv;charset=utf-8"), filtered.length);
  };

  const exportJson = () => {
    if (filtered.length === 0) {
      pushToast({ kind: "error", title: t("exporter.noData"), body: "" });
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    notifyExport(
      downloadText(`madarwa-${source}-${stamp}.json`, toJson(filtered), "application/json;charset=utf-8"),
      filtered.length,
    );
  };

  const preview = filtered.slice(0, 200);

  return (
    <div className="space-y-3">
      <SectionTitle title={t("exporter.title")} subtitle={t("exporter.subtitle")} />

      <Card>
        <h3 id="mw-exporter-source" className="mb-2 text-mw-xs font-semibold text-wa-muted">
          {t("exporter.source")}
        </h3>
        <div className="grid grid-cols-3 gap-1 rounded-md bg-wa-input p-0.5" role="group" aria-labelledby="mw-exporter-source">
          {(
            [
              { id: "groupMembers" as const, label: t("exporter.groupMembers") },
              { id: "contacts" as const, label: t("exporter.contacts") },
              { id: "chats" as const, label: t("exporter.chats") },
            ]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={source === item.id}
              onClick={() => setSource(item.id)}
              className={cn(
                "h-8 rounded-[5px] px-2 text-mw-sm font-semibold transition-colors",
                source === item.id ? "bg-wa-surface text-wa-text" : "text-wa-muted hover:text-wa-text",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {source === "groupMembers" ? (
          <div className="mt-3 space-y-2">
            <Field label={t("exporter.selectGroup")}>
              <div className="flex gap-2">
                <Select
                  value={selectedGroup}
                  onChange={(event) => {
                    // Results belong to one group; switching groups must not keep them.
                    setSelectedGroup(event.target.value);
                    setRows([]);
                    setHasExtracted(false);
                  }}
                  className="flex-1"
                >
                  {/* "No groups" is only true once loading has finished. */}
                  {groups.length === 0 ? (
                    <option value="">{loadingGroups ? t("exporter.loadingGroups") : t("exporter.noGroups")}</option>
                  ) : null}
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.participantsCount > 0
                        ? `${group.name} (${formatNumber(group.participantsCount, settings.language)})`
                        : group.name}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  size="md"
                  loading={loadingGroups}
                  onClick={() => void loadGroups()}
                  icon={<RefreshCw className="h-4 w-4" />}
                  title={t("exporter.loadGroups")}
                >
                  {t("exporter.loadGroups")}
                </Button>
              </div>
            </Field>
          </div>
        ) : null}

        {source === "contacts" ? (
          <div className="-mx-3 mt-2">
            <Toggle
              checked={onlyMyContacts}
              onChange={setOnlyMyContacts}
              label={t("exporter.onlyMyContacts")}
            />
          </div>
        ) : null}

        <Button
          className="mt-3 w-full"
          loading={extracting}
          icon={<Search className="h-4 w-4" />}
          onClick={() => void extract()}
          disabled={!bridgeConnected || (source === "groupMembers" && !selectedGroup)}
        >
          {extracting ? t("exporter.extracting") : t("exporter.extract")}
        </Button>
      </Card>

      <Card>
        <h3 className="mb-2 text-mw-xs font-semibold text-wa-muted">{t("exporter.filters")}</h3>
        <div className="-mx-3 space-y-0.5">
          {source === "groupMembers" ? (
            <Toggle checked={excludeAdmins} onChange={setExcludeAdmins} label={t("exporter.excludeAdmins")} />
          ) : null}
          <Toggle checked={onlyUnsaved} onChange={setOnlyUnsaved} label={t("exporter.onlyUnsaved")} />
        </div>
        <Field label={t("exporter.countryCode")} hint={t("exporter.countryCodeHint")} className="mt-2">
          <TextInput
            dir="ltr"
            className="mw-code max-w-[140px] text-left"
            inputMode="numeric"
            placeholder="966"
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value.replace(/\D/g, "").slice(0, 5))}
          />
        </Field>
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-mw-sm font-semibold">{t("exporter.preview")}</h3>
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
              onClick={exportCsv}
              disabled={filtered.length === 0}
            >
              {t("exporter.exportCsv")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<FileJson className="h-3.5 w-3.5" />}
              onClick={exportJson}
              disabled={filtered.length === 0}
            >
              {t("exporter.exportJson")}
            </Button>
          </div>
        </div>

        {!hasExtracted ? (
          <EmptyState title={t("exporter.noData")} />
        ) : filtered.length === 0 ? (
          <EmptyState title={t("common.noResults")} />
        ) : (
          <>
            <p className="mw-lang-pill mb-1 text-mw-xs leading-5 text-wa-muted">
              {t(source === "groupMembers" ? "exporter.membersCount" : "exporter.contactsCount", {
                count: formatNumber(filtered.length, settings.language),
              })}
              {filtered.length > preview.length ? ` · ${t("exporter.truncation")}` : ""}
            </p>
            <div className="mw-scroll max-h-[420px] divide-y divide-wa-line overflow-y-auto">
              {preview.map((row) => (
                <div key={`${row.id}-${row.phone}`} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="mw-code truncate text-mw-sm font-semibold" dir="ltr">
                      {row.formattedPhone || row.phone || row.id}
                    </p>
                    <p className="truncate text-mw-xs text-wa-muted">
                      {row.name || t("common.unnamed")}
                      {isParticipant(row) ? ` · ${row.groupName}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isParticipant(row) && row.isAdmin ? <Badge tone="neutral">{t("exporter.adminColumn")}</Badge> : null}
                    {!row.isMyContact ? <Badge tone="neutral">{t("exporter.notSaved")}</Badge> : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

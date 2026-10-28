import { useState } from "react";
import { Bot, Pencil, Plus, Send, Trash2, Type } from "lucide-react";
import type { AutoReplyRule, QuickTemplate, RuleMatchType, RuleScope } from "../../../shared/types";
import { uid } from "../../../shared/format";
import { isValidRegex } from "../../../shared/utils/rules";
import { personalizeMessage } from "../../../shared/utils/template";
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
  IconButton,
  Modal,
  SectionTitle,
  Select,
  TextArea,
  TextInput,
  Toggle,
  cn,
} from "../components";

const MATCH_TYPES: RuleMatchType[] = ["exact", "contains", "startsWith", "regex", "fallback"];
const SCOPES: RuleScope[] = ["private", "groups", "all"];

function matchLabel(t: (key: string) => string, type: RuleMatchType): string {
  switch (type) {
    case "exact":
      return t("autoreply.matchExact");
    case "contains":
      return t("autoreply.matchContains");
    case "startsWith":
      return t("autoreply.matchStartsWith");
    case "regex":
      return t("autoreply.matchRegex");
    default:
      return t("autoreply.matchFallback");
  }
}

function scopeLabel(t: (key: string) => string, scope: RuleScope): string {
  if (scope === "groups") return t("autoreply.scopeGroups");
  if (scope === "all") return t("autoreply.scopeAll");
  return t("autoreply.scopePrivate");
}

export function AutoReplyTab() {
  const t = useT();
  const settings = useSettings();
  const setSettings = useAppStore((state) => state.setSettings);
  const pushToast = useAppStore((state) => state.pushToast);

  const [draft, setDraft] = useState<AutoReplyRule | null>(null);
  const [deleteRule, setDeleteRule] = useState<AutoReplyRule | null>(null);
  const [editorError, setEditorError] = useState("");

  const [templateDraft, setTemplateDraft] = useState<QuickTemplate | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<QuickTemplate | null>(null);
  const [templateError, setTemplateError] = useState("");

  const patchAutoReply = (patch: Partial<typeof settings.autoReply>) => {
    setSettings({ ...settings, autoReply: { ...settings.autoReply, ...patch } });
  };

  const saveRule = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setEditorError(t("autoreply.ruleName"));
      return;
    }
    if (draft.matchType !== "fallback" && !draft.pattern.trim()) {
      setEditorError(t("autoreply.missingPattern"));
      return;
    }
    if (draft.matchType === "regex" && !isValidRegex(draft.pattern)) {
      setEditorError(t("autoreply.invalidRegex"));
      return;
    }
    if (!draft.response.trim()) {
      setEditorError(t("autoreply.missingResponse"));
      return;
    }
    const normalized: AutoReplyRule = {
      ...draft,
      name: draft.name.trim().slice(0, 120),
      pattern: draft.matchType === "fallback" ? "" : draft.pattern.trim().slice(0, 200),
      response: draft.response.trim().slice(0, 4096),
      cooldownMinutes: Math.min(10080, Math.max(0, Math.round(draft.cooldownMinutes))),
      typingSeconds: Math.min(30, Math.max(0, Math.round(draft.typingSeconds))),
    };
    const rules = [...settings.autoReply.rules];
    const index = rules.findIndex((rule) => rule.id === normalized.id);
    if (index >= 0) rules[index] = normalized;
    else rules.push(normalized);
    patchAutoReply({ rules });
    setDraft(null);
    setEditorError("");
    pushToast({ kind: "success", title: t("autoreply.ruleSaved"), body: "" });
  };

  const confirmDeleteRule = () => {
    if (!deleteRule) return;
    patchAutoReply({ rules: settings.autoReply.rules.filter((rule) => rule.id !== deleteRule.id) });
    setDeleteRule(null);
    pushToast({ kind: "info", title: t("autoreply.ruleDeleted"), body: "" });
  };

  const saveTemplate = () => {
    if (!templateDraft) return;
    if (!templateDraft.label.trim() || !templateDraft.text.trim()) {
      setTemplateError(t("autoreply.templateText"));
      return;
    }
    const normalized: QuickTemplate = {
      ...templateDraft,
      label: templateDraft.label.trim().slice(0, 80),
      text: templateDraft.text.trim().slice(0, 4096),
    };
    const templates = [...settings.autoReply.templates];
    const index = templates.findIndex((template) => template.id === normalized.id);
    if (index >= 0) templates[index] = normalized;
    else templates.push(normalized);
    patchAutoReply({ templates });
    setTemplateDraft(null);
    setTemplateError("");
    pushToast({ kind: "success", title: t("autoreply.templateSaved"), body: "" });
  };

  const confirmDeleteTemplate = () => {
    if (!deleteTemplate) return;
    patchAutoReply({ templates: settings.autoReply.templates.filter((template) => template.id !== deleteTemplate.id) });
    setDeleteTemplate(null);
  };

  const dispatchTemplate = async (template: QuickTemplate, mode: "send" | "insert") => {
    const text = personalizeMessage(template.text, { variables: { name: "" }, enableSpintax: true });
    if (!text) {
      pushToast({ kind: "error", title: t("autoreply.missingResponse"), body: "" });
      return;
    }
    try {
      if (mode === "send") {
        await contentController.sendTemplateToActiveChat(text);
        pushToast({ kind: "success", title: t("autoreply.templateSent"), body: template.label });
      } else {
        await contentController.insertTemplate(text);
        pushToast({ kind: "success", title: t("autoreply.templateInserted"), body: template.label });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast({
        kind: "error",
        title: message === t("errors.noChat") ? t("autoreply.noActiveChat") : t("errors.bridgeUnavailable"),
        body: message.slice(0, 180),
      });
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        icon={<Bot className="h-4 w-4" />}
        title={t("autoreply.title")}
        subtitle={t("autoreply.subtitle")}
        action={<Badge tone={settings.autoReply.enabled ? "success" : "neutral"}>{settings.autoReply.enabled ? t("common.active") : t("common.inactive")}</Badge>}
      />

      <Card className="p-1.5">
        <Toggle
          checked={settings.autoReply.enabled}
          onChange={(value) => patchAutoReply({ enabled: value })}
          label={t("autoreply.enable")}
          hint={t("autoreply.enableHint")}
        />
      </Card>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-bold">{t("autoreply.rules")}</h3>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditorError("");
              setDraft({
                id: uid("rule"),
                name: "",
                enabled: true,
                matchType: "contains",
                pattern: "",
                response: "",
                scope: "private",
                cooldownMinutes: 30,
                typingSeconds: 2,
              });
            }}
          >
            {t("autoreply.addRule")}
          </Button>
        </div>

        {settings.autoReply.rules.length === 0 ? (
          <EmptyState title={t("autoreply.noRules")} body={t("autoreply.fallbackHint")} icon={<Bot className="h-8 w-8" />} />
        ) : (
          <div className="space-y-2">
            {settings.autoReply.rules.map((rule) => (
              <Card key={rule.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[12px] font-bold">{rule.name || t("common.unnamed")}</p>
                      <Badge tone={rule.matchType === "fallback" ? "warning" : "brand"}>{matchLabel(t, rule.matchType)}</Badge>
                      {!rule.enabled ? <Badge tone="neutral">{t("common.off")}</Badge> : null}
                    </div>
                    {rule.matchType !== "fallback" ? (
                      <p className="mw-muted mw-code mt-1 truncate text-[10.5px]">{rule.pattern}</p>
                    ) : null}
                    <p className="mw-muted mt-1 line-clamp-2 text-[11px] leading-5">{rule.response}</p>
                    <div className="mw-muted mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[9.5px]">
                      <span>{scopeLabel(t, rule.scope)}</span>
                      <span>
                        {t("autoreply.cooldown")}: {rule.cooldownMinutes}
                      </span>
                      <span>
                        {t("autoreply.typing")}: {rule.typingSeconds}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                      label={t("common.edit")}
                      onClick={() => {
                        setEditorError("");
                        setDraft({ ...rule });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label={t("common.delete")} onClick={() => setDeleteRule(rule)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-[color:var(--mw-border)] pt-2">
                  <span className="mw-muted text-[9.5px]">{rule.enabled ? t("common.active") : t("common.inactive")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rule.enabled}
                    onClick={() =>
                      patchAutoReply({
                        rules: settings.autoReply.rules.map((entry) =>
                          entry.id === rule.id ? { ...entry, enabled: !entry.enabled } : entry,
                        ),
                      })
                    }
                    className={cn(
                      "relative h-5 w-9 rounded-full transition-colors",
                      rule.enabled ? "bg-brand-500" : "bg-slate-500/40",
                    )}
                  >
                    <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", rule.enabled ? "ms-[18px]" : "ms-0.5")} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
        <div className="mt-2">
          <Alert tone="info">{t("autoreply.fallbackHint")}</Alert>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-bold">{t("autoreply.templates")}</h3>
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setTemplateError("");
              setTemplateDraft({ id: uid("tpl"), label: "", text: "" });
            }}
          >
            {t("autoreply.addTemplate")}
          </Button>
        </div>

        {settings.autoReply.templates.length === 0 ? (
          <EmptyState title={t("autoreply.templates")} icon={<Type className="h-8 w-8" />} />
        ) : (
          <div className="space-y-2">
            {settings.autoReply.templates.map((template) => (
              <Card key={template.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold">{template.label}</p>
                    <p className="mw-muted mt-1 line-clamp-2 text-[11px] leading-5">{template.text}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton label={t("common.edit")} onClick={() => setTemplateDraft({ ...template })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label={t("common.delete")} onClick={() => setDeleteTemplate(template)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[color:var(--mw-border)] pt-2">
                  <Button size="sm" variant="secondary" icon={<Send className="h-3 w-3" />} onClick={() => void dispatchTemplate(template, "send")}>
                    {t("autoreply.sendTemplate")}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Type className="h-3 w-3" />} onClick={() => void dispatchTemplate(template, "insert")}>
                    {t("autoreply.insertTemplate")}
                  </Button>
                  <CopyButton text={template.text} label={t("common.copy")} copiedLabel={t("common.copied")} />
                </div>
              </Card>
            ))}
          </div>
        )}
        <p className="mw-muted mt-2 text-[10px] leading-5">{t("autoreply.variables")}</p>
      </div>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft && settings.autoReply.rules.some((rule) => rule.id === draft.id) ? t("common.edit") : t("autoreply.addRule")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={saveRule}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-3">
            <Field label={t("autoreply.ruleName")}>
              <TextInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label={t("autoreply.matchType")}>
              <Select value={draft.matchType} onChange={(event) => setDraft({ ...draft, matchType: event.target.value as RuleMatchType })}>
                {MATCH_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {matchLabel(t, type)}
                  </option>
                ))}
              </Select>
            </Field>
            {draft.matchType !== "fallback" ? (
              <Field label={t("autoreply.pattern")} hint={draft.matchType === "regex" ? t("autoreply.invalidRegex") : undefined}>
                <TextInput
                  dir="ltr"
                  className="mw-code text-left"
                  placeholder={t("autoreply.patternPlaceholder")}
                  value={draft.pattern}
                  onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
                />
              </Field>
            ) : null}
            <Field label={t("autoreply.response")} hint={t("autoreply.variables")}>
              <TextArea
                dir="auto"
                placeholder={t("autoreply.responsePlaceholder")}
                value={draft.response}
                onChange={(event) => setDraft({ ...draft, response: event.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={t("autoreply.scope")}>
                <Select value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as RuleScope })}>
                  {SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {scopeLabel(t, scope)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("autoreply.cooldown")}>
                <TextInput
                  type="number"
                  min={0}
                  max={10080}
                  value={draft.cooldownMinutes}
                  onChange={(event) => setDraft({ ...draft, cooldownMinutes: Number(event.target.value) || 0 })}
                />
              </Field>
              <Field label={t("autoreply.typing")}>
                <TextInput
                  type="number"
                  min={0}
                  max={30}
                  value={draft.typingSeconds}
                  onChange={(event) => setDraft({ ...draft, typingSeconds: Number(event.target.value) || 0 })}
                />
              </Field>
              <div className="flex items-end pb-1">
                <Toggle
                  checked={draft.enabled}
                  onChange={(value) => setDraft({ ...draft, enabled: value })}
                  label={t("autoreply.ruleActive")}
                />
              </div>
            </div>
            {editorError ? <Alert tone="danger">{editorError}</Alert> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={templateDraft !== null}
        onClose={() => setTemplateDraft(null)}
        title={t("autoreply.addTemplate")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTemplateDraft(null)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={saveTemplate}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {templateDraft ? (
          <div className="space-y-3">
            <Field label={t("autoreply.templateLabel")}>
              <TextInput value={templateDraft.label} onChange={(event) => setTemplateDraft({ ...templateDraft, label: event.target.value })} />
            </Field>
            <Field label={t("autoreply.templateText")}>
              <TextArea
                dir="auto"
                value={templateDraft.text}
                onChange={(event) => setTemplateDraft({ ...templateDraft, text: event.target.value })}
              />
            </Field>
            {templateError ? <Alert tone="danger">{templateError}</Alert> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deleteRule !== null}
        onClose={() => setDeleteRule(null)}
        title={t("common.delete")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteRule(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDeleteRule}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-6">{deleteRule?.name}</p>
      </Modal>

      <Modal
        open={deleteTemplate !== null}
        onClose={() => setDeleteTemplate(null)}
        title={t("common.delete")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTemplate(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDeleteTemplate}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-6">{deleteTemplate?.label}</p>
      </Modal>
    </div>
  );
}

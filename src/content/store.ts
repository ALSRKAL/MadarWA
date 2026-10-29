import { create } from "zustand";
import { connectionPhase, type ConnectionPhase } from "../shared/connection";
import { tFor } from "../shared/i18n";
import { createDefaultSettings } from "../shared/defaults";
import { countUnseen } from "../shared/storage";
import type {
  AppSettings,
  CampaignLogEntry,
  CampaignRecipient,
  CampaignState,
  DeletedMessage,
  EngineInfo,
  PrivacyGuardStatus,
  WebhookLogEntry,
} from "../shared/types";

export type TabId = "privacy" | "broadcaster" | "autoreply" | "exporter" | "vault" | "tools";
export type ThemeName = "light" | "dark";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: string;
  kind: "success" | "error" | "info" | "deleted";
  title: string;
  body: string;
  at: number;
  action?: ToastAction;
}

export interface ValidationState {
  active: boolean;
  current: number;
  total: number;
}

export function emptyCampaign(): CampaignState {
  return {
    id: "",
    status: "idle",
    total: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    invalid: 0,
    startedAt: 0,
    finishedAt: 0,
    logs: [],
  };
}

export function emptyValidation(): ValidationState {
  return { active: false, current: 0, total: 0 };
}

interface AppState {
  settings: AppSettings;
  engine: EngineInfo;
  bridgeConnected: boolean;
  /** True once the bridge connected at least once; a later drop reads as "reconnecting". */
  everConnected: boolean;
  /** The extension was reloaded/updated while this page stayed open. */
  orphaned: boolean;
  theme: ThemeName;
  activeTab: TabId;
  panelOpen: boolean;
  locked: boolean;
  launcherFallback: boolean;
  vault: DeletedMessage[];
  /** Entries with a later revokedAt are unseen; set when the vault is on screen. */
  vaultSeenAt: number;
  webhookLog: WebhookLogEntry[];
  campaign: CampaignState;
  recipients: CampaignRecipient[];
  validation: ValidationState;
  privacyGuard: PrivacyGuardStatus | null;
  toasts: ToastItem[];
  setSettings: (settings: AppSettings) => void;
  setEngine: (engine: EngineInfo) => void;
  setBridgeConnected: (connected: boolean) => void;
  setOrphaned: (orphaned: boolean) => void;
  setTheme: (theme: ThemeName) => void;
  setTab: (tab: TabId) => void;
  openPanel: (tab?: TabId) => void;
  closePanel: () => void;
  setLocked: (locked: boolean) => void;
  setLauncherFallback: (fallback: boolean) => void;
  setVault: (vault: DeletedMessage[]) => void;
  setVaultSeenAt: (at: number) => void;
  addVaultEntry: (entry: DeletedMessage) => void;
  clearVault: () => void;
  setWebhookLog: (log: WebhookLogEntry[]) => void;
  setCampaign: (campaign: CampaignState) => void;
  patchCampaign: (patch: Partial<CampaignState>) => void;
  appendCampaignLog: (entry: CampaignLogEntry) => void;
  setRecipients: (recipients: CampaignRecipient[]) => void;
  setValidation: (validation: ValidationState) => void;
  setPrivacyGuard: (guard: PrivacyGuardStatus | null) => void;
  resetCampaign: () => void;
  pushToast: (toast: Omit<ToastItem, "id" | "at">) => void;
  dismissToast: (id: string) => void;
}

let toastCounter = 0;

export const useAppStore = create<AppState>((set) => ({
  settings: createDefaultSettings(),
  engine: { ready: false, wppVersion: "", me: "", connected: false },
  bridgeConnected: false,
  everConnected: false,
  orphaned: false,
  theme: "dark",
  activeTab: "privacy",
  panelOpen: false,
  locked: false,
  launcherFallback: false,
  vault: [],
  vaultSeenAt: 0,
  webhookLog: [],
  campaign: emptyCampaign(),
  recipients: [],
  validation: emptyValidation(),
  privacyGuard: null,
  toasts: [],

  setSettings: (settings) => set({ settings }),
  setEngine: (engine) => set({ engine }),
  setBridgeConnected: (bridgeConnected) =>
    set((state) => ({ bridgeConnected, everConnected: state.everConnected || bridgeConnected })),
  setOrphaned: (orphaned) => set({ orphaned }),
  setTheme: (theme) => set({ theme }),
  setTab: (activeTab) => set({ activeTab }),
  openPanel: (tab) => set((state) => ({ panelOpen: true, activeTab: tab ?? state.activeTab })),
  closePanel: () => set({ panelOpen: false }),
  setLocked: (locked) => set({ locked }),
  setLauncherFallback: (launcherFallback) => set({ launcherFallback }),
  setVault: (vault) => set({ vault }),
  setVaultSeenAt: (vaultSeenAt) => set({ vaultSeenAt }),
  addVaultEntry: (entry) =>
    set((state) => {
      if (state.vault.some((item) => item.id === entry.id)) return state;
      return { vault: [entry, ...state.vault].slice(0, 1000) };
    }),
  clearVault: () => set({ vault: [] }),
  setWebhookLog: (webhookLog) => set({ webhookLog }),
  setCampaign: (campaign) => set({ campaign }),
  patchCampaign: (patch) => set((state) => ({ campaign: { ...state.campaign, ...patch } })),
  appendCampaignLog: (entry) =>
    set((state) => ({
      campaign: { ...state.campaign, logs: [...state.campaign.logs.slice(-499), entry] },
    })),
  setRecipients: (recipients) => set({ recipients }),
  setValidation: (validation) => set({ validation }),
  setPrivacyGuard: (privacyGuard) => set({ privacyGuard }),
  resetCampaign: () => set({ campaign: emptyCampaign(), recipients: [], validation: emptyValidation() }),
  pushToast: (toast) =>
    set((state) => {
      toastCounter += 1;
      const item: ToastItem = {
        ...toast,
        id: `toast-${Date.now()}-${toastCounter}`,
        at: Date.now(),
      };
      return { toasts: [item, ...state.toasts].slice(0, 4) };
    }),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const useSettings = (): AppSettings => useAppStore((state) => state.settings);

export function selectConnectionPhase(
  state: Pick<AppState, "bridgeConnected" | "engine" | "orphaned" | "everConnected">,
): ConnectionPhase {
  return connectionPhase({
    bridgeConnected: state.bridgeConnected,
    engine: state.engine,
    orphaned: state.orphaned,
    everConnected: state.everConnected,
  });
}

export const useConnectionPhase = (): ConnectionPhase => useAppStore(selectConnectionPhase);

/** New deleted messages the user has not looked at yet (launcher, rail and toolbar badge). */
export function selectUnseenVault(state: Pick<AppState, "vault" | "vaultSeenAt">): number {
  return countUnseen(state.vault, state.vaultSeenAt);
}

export const useUnseenVault = (): number => useAppStore(selectUnseenVault);

export const useT = (): ((key: string, variables?: Record<string, unknown>) => string) => {
  const language = useAppStore((state) => state.settings.language);
  return tFor(language);
};


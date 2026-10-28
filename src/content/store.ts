import { create } from "zustand";
import { tFor } from "../shared/i18n";
import { createDefaultSettings } from "../shared/defaults";
import type {
  AppSettings,
  CampaignLogEntry,
  CampaignRecipient,
  CampaignState,
  DeletedMessage,
  EngineInfo,
  WebhookLogEntry,
} from "../shared/types";

export type TabId = "privacy" | "broadcaster" | "autoreply" | "exporter" | "vault" | "tools";
export type ThemeName = "light" | "dark";

export interface ToastItem {
  id: string;
  kind: "success" | "error" | "info" | "deleted";
  title: string;
  body: string;
  at: number;
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
  theme: ThemeName;
  activeTab: TabId;
  panelOpen: boolean;
  locked: boolean;
  launcherFallback: boolean;
  vault: DeletedMessage[];
  webhookLog: WebhookLogEntry[];
  campaign: CampaignState;
  recipients: CampaignRecipient[];
  validation: ValidationState;
  toasts: ToastItem[];
  setSettings: (settings: AppSettings) => void;
  setEngine: (engine: EngineInfo) => void;
  setBridgeConnected: (connected: boolean) => void;
  setTheme: (theme: ThemeName) => void;
  setTab: (tab: TabId) => void;
  openPanel: (tab?: TabId) => void;
  closePanel: () => void;
  setLocked: (locked: boolean) => void;
  setLauncherFallback: (fallback: boolean) => void;
  setVault: (vault: DeletedMessage[]) => void;
  addVaultEntry: (entry: DeletedMessage) => void;
  clearVault: () => void;
  setWebhookLog: (log: WebhookLogEntry[]) => void;
  setCampaign: (campaign: CampaignState) => void;
  patchCampaign: (patch: Partial<CampaignState>) => void;
  appendCampaignLog: (entry: CampaignLogEntry) => void;
  setRecipients: (recipients: CampaignRecipient[]) => void;
  setValidation: (validation: ValidationState) => void;
  resetCampaign: () => void;
  pushToast: (toast: Omit<ToastItem, "id" | "at">) => void;
  dismissToast: (id: string) => void;
}

let toastCounter = 0;

export const useAppStore = create<AppState>((set) => ({
  settings: createDefaultSettings(),
  engine: { ready: false, wppVersion: "", me: "", connected: false },
  bridgeConnected: false,
  theme: "dark",
  activeTab: "privacy",
  panelOpen: false,
  locked: false,
  launcherFallback: false,
  vault: [],
  webhookLog: [],
  campaign: emptyCampaign(),
  recipients: [],
  validation: emptyValidation(),
  toasts: [],

  setSettings: (settings) => set({ settings }),
  setEngine: (engine) => set({ engine }),
  setBridgeConnected: (bridgeConnected) => set({ bridgeConnected }),
  setTheme: (theme) => set({ theme }),
  setTab: (activeTab) => set({ activeTab }),
  openPanel: (tab) => set((state) => ({ panelOpen: true, activeTab: tab ?? state.activeTab })),
  closePanel: () => set({ panelOpen: false }),
  setLocked: (locked) => set({ locked }),
  setLauncherFallback: (launcherFallback) => set({ launcherFallback }),
  setVault: (vault) => set({ vault }),
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

export const useT = (): ((key: string, variables?: Record<string, unknown>) => string) => {
  const language = useAppStore((state) => state.settings.language);
  return tFor(language);
};


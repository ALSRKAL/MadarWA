type AnyFunction = (...args: unknown[]) => unknown;
type ModuleExports = Record<string, unknown>;

interface PatchSlot {
  owner: ModuleExports;
  key: string;
  descriptor: PropertyDescriptor;
}

export interface DeliveryGuardResult {
  active: boolean;
  patched: number;
  unsupported: number;
  modules: string[];
}

const DELIVERY_FUNCTIONS: ReadonlyArray<readonly [string, string]> = [
  ["WAWebSendDeliveryReceiptJob", "sendDeliveryReceiptsAfterDecryption"],
  ["WAWebSendOfflineDeliveryReceiptJob", "sendAggregateOfflineReceipts"],
  ["WAWebSendAggregateDeliveryReceipts", "aggregateDeliveryReceipts"],
];

const COMMON_MODULE = "WAWebSendReceiptJobCommon";

const SAFE_RECEIPT_TYPES = new Set(["history-sync-completion", "server-error"]);

const OPTIONAL_RECEIPT_MODULES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["WAWebSendReceiptJob", ["default", "sendReceipt", "sendReceipts"]],
  ["WAWebHandleMsgSendReceipt", ["sendReceipt"]],
];

function asModule(value: unknown): ModuleExports | null {
  return value && (typeof value === "object" || typeof value === "function")
    ? (value as ModuleExports)
    : null;
}

function normalizeReceiptType(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function receiptTypeOf(value: unknown, depth = 0): string {
  if (!value || depth > 3) return "";
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      const type = receiptTypeOf(item, depth + 1);
      if (type) return type;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["receiptType", "type"]) {
    const raw = record[key];
    if (typeof raw === "string" && raw) return normalizeReceiptType(raw);
  }
  for (const key of ["receipt", "receipts", "messages", "items", "participant"]) {
    const type = receiptTypeOf(record[key], depth + 1);
    if (type) return type;
  }
  return "";
}

function shouldBlockAggregateReceipt(value: unknown): boolean {
  const type = receiptTypeOf(value);
  // Unknown payload shapes are blocked too: an unclassified receipt must not
  // leak delivery/read state while single-tick mode is on.
  return !type || !SAFE_RECEIPT_TYPES.has(type);
}

/**
 * Blocks WhatsApp Web's delivery receipts so a sender keeps one grey tick,
 * while incoming messages still reach the local store/UI. Only delivery
 * receipts are touched; read/played receipts are handled by the account
 * privacy settings and the existing ReceiptGuard.
 */
export class DeliveryReceiptGuard {
  private slots: PatchSlot[] = [];
  private signature = "";
  private last: DeliveryGuardResult = { active: false, patched: 0, unsupported: 0, modules: [] };

  sync(loadModule: ((name: string) => unknown) | undefined, enabled: boolean): DeliveryGuardResult {
    const signature = enabled ? "1" : "0";
    if (signature === this.signature) return this.last;

    this.restore();
    if (!enabled) {
      this.signature = signature;
      this.last = { active: false, patched: 0, unsupported: 0, modules: [] };
      return this.last;
    }

    if (typeof loadModule !== "function") {
      this.signature = signature;
      this.last = {
        active: false,
        patched: 0,
        unsupported: DELIVERY_FUNCTIONS.length + 1,
        modules: [],
      };
      return this.last;
    }

    let patched = 0;
    let unsupported = 0;
    const modules: string[] = [];

    for (const [moduleName, functionName] of DELIVERY_FUNCTIONS) {
      const module = this.load(loadModule, moduleName);
      if (!module || typeof module[functionName] !== "function") {
        unsupported += 1;
        continue;
      }
      if (this.patch(module, functionName, this.noop())) {
        patched += 1;
        modules.push(`${moduleName}.${functionName}`);
      } else {
        unsupported += 1;
      }
    }

    const common = this.load(loadModule, COMMON_MODULE);
    if (common && typeof common.sendAggregateReceipts === "function") {
      const original = common.sendAggregateReceipts as AnyFunction;
      const filtered: AnyFunction = function (this: unknown, ...args: unknown[]) {
        if (shouldBlockAggregateReceipt(args[0])) return undefined;
        return original.apply(this, args);
      };
      (filtered as AnyFunction & { __madarwa?: string }).__madarwa = "receipt-filter";
      if (this.patch(common, "sendAggregateReceipts", filtered)) {
        patched += 1;
        modules.push(`${COMMON_MODULE}.sendAggregateReceipts`);
      } else {
        unsupported += 1;
      }
    } else {
      unsupported += 1;
    }

    // Optional jobs vary across WhatsApp builds. Patch every known send entry
    // that exists; a missing optional module is not a failure.
    for (const [moduleName, keys] of OPTIONAL_RECEIPT_MODULES) {
      const module = this.load(loadModule, moduleName);
      if (!module) continue;
      for (const key of keys) {
        if (typeof module[key] !== "function") continue;
        if (this.patch(module, key, this.noop())) {
          patched += 1;
          modules.push(`${moduleName}.${key}`);
        }
      }
    }

    this.signature = signature;
    this.last = { active: patched > 0, patched, unsupported, modules };
    return this.last;
  }

  status(): DeliveryGuardResult {
    return this.last;
  }

  private load(loadModule: (name: string) => unknown, name: string): ModuleExports | null {
    try {
      return asModule(loadModule(name));
    } catch {
      return null;
    }
  }

  private noop(): AnyFunction {
    const replacement: AnyFunction = () => undefined;
    (replacement as AnyFunction & { __madarwa?: string }).__madarwa = "delivery-noop";
    return replacement;
  }

  private patch(owner: ModuleExports, key: string, replacement: AnyFunction): boolean {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (!descriptor || typeof descriptor.value !== "function") return false;
    try {
      if (descriptor.configurable) {
        Object.defineProperty(owner, key, {
          configurable: true,
          enumerable: descriptor.enumerable ?? true,
          writable: true,
          value: replacement,
        });
      } else if (descriptor.writable) {
        owner[key] = replacement;
      } else {
        return false;
      }
      this.slots.push({ owner, key, descriptor });
      return true;
    } catch {
      return false;
    }
  }

  private restore(): void {
    for (const slot of this.slots.reverse()) {
      try {
        Object.defineProperty(slot.owner, slot.key, slot.descriptor);
      } catch {
        // Leave the patch in place if WhatsApp made the export non-configurable.
      }
    }
    this.slots = [];
  }
}

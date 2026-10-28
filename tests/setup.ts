import { webcrypto } from "node:crypto";

// jsdom ships crypto.getRandomValues but not SubtleCrypto; PIN tests need PBKDF2.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

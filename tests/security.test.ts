import { describe, expect, it } from "vitest";
import { buildWebhookHeaders, timingSafeEqual, validateWebhookUrl } from "../src/shared/utils/security";

describe("webhook SSRF guard", () => {
  it("accepts public http and https endpoints", () => {
    for (const url of [
      "https://api.example.org/madarwa/hook",
      "http://hooks.example.net:8080/events?token=public",
      "https://[2606:4700:4700::1111]/webhook",
      "https://8.8.8.8/hook",
    ]) {
      const result = validateWebhookUrl(url);
      expect(result.ok, `${url}: ${result.reason}`).toBe(true);
    }
  });

  it("rejects non-http schemes and embedded credentials", () => {
    expect(validateWebhookUrl("ftp://example.org/hook").code).toBe("scheme");
    expect(validateWebhookUrl("file:///etc/passwd").code).toBe("scheme");
    expect(validateWebhookUrl("javascript:alert(1)").code).toBe("scheme");
    expect(validateWebhookUrl("https://user:pass@example.org/hook").code).toBe("credentials");
  });

  it("blocks localhost and private IPv4 targets", () => {
    const urls = [
      "http://localhost/hook",
      "http://localhost:8080/hook",
      "http://app.localhost/hook",
      "http://127.0.0.1/hook",
      "http://127.10.20.30/hook",
      "http://10.0.0.5/hook",
      "http://172.16.0.1/hook",
      "http://172.31.255.255/hook",
      "http://192.168.1.10/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/hook",
      "http://100.64.0.1/hook",
      "http://224.0.0.1/hook",
      "http://255.255.255.255/hook",
    ];
    for (const url of urls) {
      expect(validateWebhookUrl(url).ok, url).toBe(false);
    }
  });

  it("blocks numeric and obfuscated loopback forms", () => {
    expect(validateWebhookUrl("http://2130706433/hook").ok).toBe(false);
    expect(validateWebhookUrl("http://0x7f000001/hook").ok).toBe(false);
    expect(validateWebhookUrl("http://0177.0.0.1/hook").ok).toBe(false);
    expect(validateWebhookUrl("http://017700000001/hook").ok).toBe(false);
  });

  it("blocks IPv6 loopback, ULA, link-local, documentation and mapped private ranges", () => {
    const urls = [
      "http://[::1]/hook",
      "http://[::]/hook",
      "http://[fc00::1]/hook",
      "http://[fd12:3456:789a::1]/hook",
      "http://[fe80::1]/hook",
      "http://[2001:db8::1]/hook",
      "http://[::ffff:127.0.0.1]/hook",
      "http://[::ffff:192.168.1.1]/hook",
    ];
    for (const url of urls) {
      expect(validateWebhookUrl(url).ok, url).toBe(false);
    }
  });

  it("blocks local and reserved hostnames", () => {
    for (const url of [
      "http://intranet/hook",
      "http://printer.local/hook",
      "http://service.internal/hook",
      "http://app.home.arpa/hook",
      "http://metadata.google.internal/latest",
      "http://metadata.google.internal./latest",
      "http://thing.test/hook",
      "http://thing.invalid/hook",
      "http://thing.example/hook",
    ]) {
      expect(validateWebhookUrl(url).ok, url).toBe(false);
    }
  });

  it("rejects malformed, empty, overlong and port-zero URLs", () => {
    expect(validateWebhookUrl("").code).toBe("empty");
    expect(validateWebhookUrl("not a url").code).toBe("malformed");
    expect(validateWebhookUrl(`https://example.org/${"a".repeat(2100)}`).code).toBe("too-long");
    expect(validateWebhookUrl("https://example.org:0/hook").code).toBe("port");
  });

  it("returns a normalised URL", () => {
    const result = validateWebhookUrl("HTTPS://API.Example.ORG/hook");
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://api.example.org/hook");
  });
});

describe("webhook headers and comparison", () => {
  it("sends the token header only when configured", () => {
    const headers = buildWebhookHeaders("a-long-token-value");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-MadarWA-Token"]).toBe("a-long-token-value");
    expect(buildWebhookHeaders("")).not.toHaveProperty("X-MadarWA-Token");
    expect(buildWebhookHeaders("x".repeat(500))["X-MadarWA-Token"]).toHaveLength(256);
  });

  it("compares values without early exit", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("a", "")).toBe(false);
  });
});

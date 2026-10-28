import { describe, it, expect } from "vitest";
import {
  serializeSessionToUrl,
  parseSessionFromUrl,
} from "@/store/session";
import type { Network } from "@/lib/types";

describe("Session Sharing (Issue #23)", () => {
  it("serializes tx hash and network into URL query params", () => {
    const txHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const network: Network = "testnet";
    const url = serializeSessionToUrl(txHash, network, "https://prism.stellar.org/decode");

    expect(url).toBe(
      `https://prism.stellar.org/decode?tx=${encodeURIComponent(txHash)}&network=testnet`
    );
  });

  it("parses tx hash and network correctly from shared URL", () => {
    const rawUrl =
      "https://prism.stellar.org/decode?tx=0x1234abcd&network=futurenet";
    const parsed = parseSessionFromUrl(rawUrl);

    expect(parsed.tx).toBe("0x1234abcd");
    expect(parsed.network).toBe("futurenet");
  });

  it("supports legacy txHash parameter during parsing", () => {
    const query = "?txHash=0x99998888&network=mainnet";
    const parsed = parseSessionFromUrl(query);

    expect(parsed.tx).toBe("0x99998888");
    expect(parsed.network).toBe("mainnet");
  });

  it("handles malformed search input gracefully", () => {
    const parsed = parseSessionFromUrl("");
    expect(parsed.tx).toBeNull();
    expect(parsed.network).toBeNull();
  });
});

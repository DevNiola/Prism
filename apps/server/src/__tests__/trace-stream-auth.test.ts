import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTraceStream } from "../ws/trace-stream";
import { SessionStore } from "../session-store";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Mock SessionStore so tests run without a real Redis connection
// ---------------------------------------------------------------------------
const mockVerifyToken = vi.fn<[string, string], Promise<boolean>>();

vi.mock("../session-store", () => {
  return {
    SessionStore: vi.fn().mockImplementation(() => ({
      verifyToken: mockVerifyToken,
    })),
  };
});

const TEST_PORT = 19876;

describe("trace-stream WebSocket authentication", () => {
  let wss: ReturnType<typeof createTraceStream>;
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore("redis://localhost:6379");
    wss = createTraceStream(TEST_PORT, store);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    vi.clearAllMocks();
  });

  function connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
      client.once("open", () => resolve(client));
      client.once("error", reject);
    });
  }

  it("closes with code 4001 when subscribe has no session_id or token", async () => {
    const client = await connect();

    const closeCode = await new Promise<number>((resolve) => {
      client.once("close", (code) => resolve(code));
      client.send(
        JSON.stringify({ type: "subscribe", tx_hash: "abc123" }),
      );
    });

    expect(closeCode).toBe(4001);
  });

  it("closes with code 4001 when the token is invalid", async () => {
    mockVerifyToken.mockResolvedValueOnce(false);

    const client = await connect();

    const closeCode = await new Promise<number>((resolve) => {
      client.once("close", (code) => resolve(code));
      client.send(
        JSON.stringify({
          type: "subscribe",
          tx_hash: "abc123",
          session_id: "sess-1",
          token: "bad-token",
        }),
      );
    });

    expect(closeCode).toBe(4001);
  });

  it("sends subscribed when session_id and token are valid", async () => {
    mockVerifyToken.mockResolvedValueOnce(true);

    const client = await connect();

    const message = await new Promise<string>((resolve) => {
      client.once("message", (data) => resolve(data.toString()));
      client.send(
        JSON.stringify({
          type: "subscribe",
          tx_hash: "abc123",
          session_id: "sess-1",
          token: "valid-token",
        }),
      );
    });

    const parsed = JSON.parse(message);
    expect(parsed.type).toBe("subscribed");
    expect(parsed.tx_hash).toBe("abc123");

    client.close();
  });
});

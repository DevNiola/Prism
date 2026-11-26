import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { StructuredLogger, redactSensitiveFields, REDACTED_KEYS } from "../logger";

describe("StructuredLogger", () => {
  let logger: StructuredLogger;
  let stdoutData: string[] = [];
  let stderrData: string[] = [];

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    logger = new StructuredLogger();
    logger.setLevel("debug");
    stdoutData = [];
    stderrData = [];

    // Intercept stdout and stderr writes
    process.stdout.write = ((chunk: string) => {
      stdoutData.push(chunk);
      return true;
    }) as any;

    process.stderr.write = ((chunk: string) => {
      stderrData.push(chunk);
      return true;
    }) as any;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it("should redact Authorization header from metadata", () => {
    logger.info("Test message", {
      authorization: "Bearer secret-token-12345",
      method: "POST",
    });

    const logged = stdoutData.join("");
    expect(logged).toContain('"authorization":"[REDACTED]"');
    expect(logged).not.toContain("secret-token-12345");
  });

  it("should redact cookie header from metadata", () => {
    logger.warn("Cookie test", {
      cookie: "session=abc123; auth=xyz789",
      url: "/api/test",
    });

    const logged = stdoutData.join("");
    expect(logged).toContain('"cookie":"[REDACTED]"');
    expect(logged).not.toContain("abc123");
    expect(logged).not.toContain("xyz789");
  });

  it("should redact ai_api_key from metadata", () => {
    logger.error("AI error", {
      ai_api_key: "sk-proj-1234567890abcdef",
      status: "failed",
    });

    const logged = stderrData.join("");
    expect(logged).toContain('"ai_api_key":"[REDACTED]"');
    expect(logged).not.toContain("sk-proj-1234567890abcdef");
  });

  it("should redact all keys in REDACTED_KEYS list (case-insensitive)", () => {
    const meta: Record<string, string> = {};
    for (const key of REDACTED_KEYS) {
      meta[key] = `secret-${key}`;
    }

    logger.info("Multi-redact", meta);

    const logged = stdoutData.join("");
    for (const key of REDACTED_KEYS) {
      expect(logged).toContain(`"${key}":"[REDACTED]"`);
      expect(logged).not.toContain(`secret-${key}`);
    }
  });

  it("should redact nested objects", () => {
    logger.info("Nested test", {
      request: {
        headers: {
          authorization: "Bearer nested-secret",
          "content-type": "application/json",
        },
      },
    });

    const logged = stdoutData.join("");
    expect(logged).toContain('"authorization":"[REDACTED]"');
    expect(logged).not.toContain("nested-secret");
    expect(logged).toContain('"content-type":"application/json"');
  });

  it("should redact arrays of objects", () => {
    logger.info("Array test", {
      requests: [
        { token: "token-1", id: "req-1" },
        { token: "token-2", id: "req-2" },
      ],
    });

    const logged = stdoutData.join("");
    expect(logged).toContain('"token":"[REDACTED]"');
    expect(logged).not.toContain("token-1");
    expect(logged).not.toContain("token-2");
    expect(logged).toContain('"id":"req-1"');
    expect(logged).toContain('"id":"req-2"');
  });

  it("should not mutate the original metadata object", () => {
    const original = { authorization: "Bearer secret", method: "GET" };
    const copy = { ...original };

    logger.info("Mutation test", original);

    expect(original).toEqual(copy);
    expect(original.authorization).toBe("Bearer secret");
  });

  it("should handle case-insensitive redaction (Authorization vs authorization)", () => {
    logger.info("Case test", {
      Authorization: "Bearer uppercase-token",
      authorization: "Bearer lowercase-token",
    });

    const logged = stdoutData.join("");
    expect(logged).toContain('"Authorization":"[REDACTED]"');
    expect(logged).toContain('"authorization":"[REDACTED]"');
    expect(logged).not.toContain("uppercase-token");
    expect(logged).not.toContain("lowercase-token");
  });
});

describe("redactSensitiveFields", () => {
  it("should redact a flat object", () => {
    const input = {
      username: "alice",
      password: "super-secret",
      email: "alice@example.com",
    };

    const result = redactSensitiveFields(input);
    expect(result).toEqual({
      username: "alice",
      password: "[REDACTED]",
      email: "alice@example.com",
    });
  });

  it("should redact deeply nested objects", () => {
    const input = {
      user: {
        credentials: {
          token: "secret-token",
          apiKey: "not-a-secret",
        },
      },
    };

    const result = redactSensitiveFields(input);
    expect(result).toEqual({
      user: {
        credentials: {
          token: "[REDACTED]",
          apiKey: "not-a-secret",
        },
      },
    });
  });

  it("should handle arrays", () => {
    const input = [
      { token: "t1", id: 1 },
      { token: "t2", id: 2 },
    ];

    const result = redactSensitiveFields(input);
    expect(result).toEqual([
      { token: "[REDACTED]", id: 1 },
      { token: "[REDACTED]", id: 2 },
    ]);
  });

  it("should handle primitives", () => {
    expect(redactSensitiveFields("plain string")).toBe("plain string");
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields(null)).toBe(null);
    expect(redactSensitiveFields(undefined)).toBe(undefined);
  });
});

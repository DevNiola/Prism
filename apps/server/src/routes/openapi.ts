import type { FastifyInstance } from "fastify";

/**
 * OpenAPI 3.1 document describing all v1 API routes.
 * Served at GET /v1/openapi.json — keep in sync with routes/*.ts.
 */
const openapiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Grat API",
    version: "0.1.0",
    description:
      "Machine-readable contract for the Grat Soroban transaction debugger server.",
  },
  servers: [{ url: "/", description: "Current host" }],
  paths: {
    "/health": {
      get: {
        operationId: "getHealth",
        summary: "Health check",
        tags: ["Health"],
        responses: {
          "200": {
            description: "Server is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    version: { type: "string", example: "0.1.0" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/replay": {
      post: {
        operationId: "postReplay",
        summary: "Queue a replay job",
        tags: ["Replay"],
        responses: {
          "200": {
            description: "Job queued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "queued" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/replay/{jobId}": {
      get: {
        operationId: "getReplayStatus",
        summary: "Get replay job status",
        tags: ["Replay"],
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Job status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "pending" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/session": {
      post: {
        operationId: "createSession",
        summary: "Create a debug session",
        tags: ["Session"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["txHash", "network", "wsUrl"],
                properties: {
                  txHash: { type: "string", minLength: 1 },
                  network: { type: "string", minLength: 1 },
                  wsUrl: { type: "string", minLength: 1 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Session created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sessionId: { type: "string" },
                    token: { type: "string" },
                    wsUrl: { type: "string" },
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/session/{sessionId}": {
      get: {
        operationId: "getSession",
        summary: "Get session metadata",
        tags: ["Session"],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Session found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "active" },
                    session: { type: "object" },
                  },
                },
              },
            },
          },
          "404": { description: "Session not found" },
        },
      },
      delete: {
        operationId: "deleteSession",
        summary: "Close a debug session",
        tags: ["Session"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "204": { description: "Session deleted" },
          "401": { description: "Missing Authorization header" },
          "403": { description: "Invalid or expired token" },
          "404": { description: "Session not found" },
        },
      },
    },
    "/api/session/{sessionId}/snapshot": {
      patch: {
        operationId: "updateSessionSnapshot",
        summary: "Push an updated trace snapshot",
        tags: ["Session"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["snapshot"],
                properties: {
                  snapshot: {
                    type: "object",
                    required: [
                      "ledger_sequence",
                      "nodes",
                      "state_diff",
                      "completed",
                    ],
                    properties: {
                      ledger_sequence: { type: "number" },
                      nodes: { type: "array" },
                      state_diff: { type: "array" },
                      completed: { type: "boolean" },
                      resource_profile: {
                        oneOf: [{ type: "object" }, { type: "null" }],
                      },
                      error: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Snapshot updated" },
          "401": { description: "Missing Authorization header" },
          "403": { description: "Invalid or expired token" },
          "404": { description: "Session not found" },
        },
      },
    },
    "/api/session/{sessionId}/heartbeat": {
      post: {
        operationId: "sessionHeartbeat",
        summary: "Send a session heartbeat",
        tags: ["Session"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Heartbeat accepted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    updatedAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "401": { description: "Missing Authorization header" },
          "403": { description: "Invalid or expired token" },
          "404": { description: "Session not found" },
        },
      },
    },
    "/api/ai/explain": {
      post: {
        operationId: "aiExplain",
        summary: "Get AI explanation for a diagnostic report",
        tags: ["AI"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["report", "tx_hash", "network"],
                properties: {
                  report: { type: "object" },
                  tx_hash: { type: "string" },
                  network: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "AI explanation returned" },
          "400": { description: "Missing required fields" },
          "429": { description: "Budget or concurrency limit exceeded" },
          "500": { description: "Internal server error" },
        },
      },
    },
    "/api/ai/budget": {
      get: {
        operationId: "getAiBudget",
        summary: "Get current AI token budget status",
        tags: ["AI"],
        responses: {
          "200": { description: "Budget status" },
        },
      },
    },
    "/api/ai/cache/{txHash}": {
      delete: {
        operationId: "invalidateAiCacheByTxHash",
        summary: "Invalidate cached AI responses for a transaction",
        tags: ["AI"],
        parameters: [
          {
            name: "txHash",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Invalidated count",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    invalidated: { type: "number" },
                    tx_hash: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/ai/cache": {
      delete: {
        operationId: "clearAiCache",
        summary: "Clear the entire AI response cache",
        tags: ["AI"],
        responses: {
          "200": {
            description: "Total invalidated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { invalidated: { type: "number" } },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
  },
} as const;

export async function openapiRoute(app: FastifyInstance) {
  app.get("/v1/openapi.json", async (_request, reply) => {
    return reply
      .header("Content-Type", "application/json")
      .send(openapiDocument);
  });
}

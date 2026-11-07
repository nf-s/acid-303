import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig(({ mode }) => ({
  accountId: "90cacd9638ec3879a2f19b61cf1e1073",
  worker: {
    name: "grain-sessions",
    entrypoint: "src/index.ts",
    compatibilityDate: "2026-11-07",
    compatibilityFlags: ["nodejs_compat"],
    exports: { SessionRoom: exports.durableObject({ storage: "sqlite" }) },
    env: {
      ROOMS: bindings.durableObject({
        worker: "grain-sessions",
        exportName: "SessionRoom",
      }),
      ALLOWED_ORIGIN: bindings.text("https://acid-303.pages.dev"),
      ALLOW_LOCALHOST: bindings.text(mode === "development" ? "true" : "false"),
      CREATE_LIMIT: bindings.rateLimit({
        namespace: "1226289101",
        simple: { limit: 6, period: 60 },
      }),
      GLOBAL_CREATE_LIMIT: bindings.rateLimit({
        namespace: "1226289102",
        simple: { limit: 60, period: 60 },
      }),
      CONNECT_LIMIT: bindings.rateLimit({
        namespace: "1226289103",
        simple: { limit: 60, period: 60 },
      }),
    },
    observability: {
      enabled: true,
      logs: { enabled: true, headSamplingRate: 0.1 },
      traces: { enabled: true, headSamplingRate: 0.01 },
    },
  },
}));

import type { TypeSpec } from "@nodish/core";

export const AI_CLIENT_TYPE = "ai/client";
export const AI_SECRET_TYPE = "ai/secret";

export type PublicAiClient = {
  provider: "publicai";
  apiKey: string;
  model: string;
  /** When true, consumers skip the network and return null. */
  disable: boolean;
};

export function isPublicAiClient(value: unknown): value is PublicAiClient {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.provider !== "publicai") return false;
  if (typeof v.apiKey !== "string") return false;
  if (typeof v.model !== "string") return false;
  if (v.disable !== undefined && typeof v.disable !== "boolean") return false;
  const disable = v.disable === true;
  if (!disable && (v.apiKey.length === 0 || v.model.trim().length === 0)) {
    return false;
  }
  return true;
}

export function asPublicAiClient(value: unknown): PublicAiClient {
  if (!isPublicAiClient(value)) {
    throw new Error("Expected ai/client (Public AI)");
  }
  return {
    provider: "publicai",
    apiKey: value.apiKey,
    model: value.model,
    disable: value.disable === true,
  };
}

export const AiSecret: TypeSpec = {
  id: AI_SECRET_TYPE,
  label: "Secret",
  color: "#c45c5c",
  widgets: {
    default: {
      kind: "custom",
      componentId: "ai-password",
    },
  },
  validate: (value: unknown) => value === undefined || typeof value === "string",
  format: () => "********",
  defaultValue: "",
};

export const AiClient: TypeSpec = {
  id: AI_CLIENT_TYPE,
  label: "AI client",
  color: "#6c8cff",
  widgets: {
    default: {
      kind: "none",
    },
  },
  validate: (value: unknown) => value === null || isPublicAiClient(value),
  format: (value: unknown) => {
    if (!isPublicAiClient(value)) return "(invalid client)";
    const off = value.disable ? " · disabled" : "";
    return `publicai · ${value.model || "(no model)"}${off} · ********`;
  },
};

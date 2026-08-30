import type { NodeSpec, NodeSpecRegistry } from "@nodish/core";
import { realizeNewlines } from "./newlines";
import { parseChoiceJson, publicAiChatCompletionsSync } from "./publicai";
import {
  AI_CLIENT_TYPE,
  AI_SECRET_TYPE,
  asPublicAiClient,
  type PublicAiClient,
} from "./types";

const AI_COLOR = "#6c8cff";
const TEXT_COLOR = "#8ab4f8";
const DEFAULT_MODEL = "swiss-ai/apertus-v1.5-8b";
const MIN_N = 2;
const MAX_N = 8;

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function clampN(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return MIN_N;
  return Math.min(MAX_N, Math.max(MIN_N, Math.round(n)));
}

const publicAiClient: NodeSpec = {
  typeId: "ai/publicai-client",
  displayName: "Public AI client",
  description:
    "Wrap a Public AI API key + model as an ai/client. The key uses a password field in the UI, but is still stored in the graph/project like other port values. As such, treat projects with keys as secrets.",
  color: AI_COLOR,
  group: ["AI", "Public AI"],
  inputs: {
    apiKey: {
      type: AI_SECRET_TYPE,
      defaultValue: "",
    },
    model: {
      type: "string",
      defaultValue: DEFAULT_MODEL,
    },
    disable: {
      type: "boolean",
      userOnly: true,
      defaultValue: false,
    },
  },
  outputs: {
    client: { type: AI_CLIENT_TYPE },
  },
  execute: (inputs) => {
    const disable = inputs.disable === true;
    const apiKey = asString(inputs.apiKey).trim();
    const model = asString(inputs.model).trim() || DEFAULT_MODEL;
    if (!disable && !apiKey) throw new Error("API key is required");
    const client: PublicAiClient = {
      provider: "publicai",
      apiKey,
      model,
      disable,
    };
    return { client };
  },
};

const choose: NodeSpec = {
  typeId: "ai/choose",
  displayName: "AI choose",
  description:
    "Ask Public AI to pick one of N option strings given a prompt and data. Returns the chosen string and reasoning. Uses sync XHR via /publicai (blocks the UI while waiting). Experimental.",
  color: AI_COLOR,
  group: ["AI"],
  inputs: {
    client: { type: AI_CLIENT_TYPE },
    prompt: {
      type: "string",
      defaultValue: "",
      customProps: { rows: 5 },
    },
    data: {
      type: "string",
      defaultValue: "",
      customProps: { rows: 5 },
    },
    N: {
      type: "number",
      userOnly: true,
      defaultValue: MIN_N,
    },
    option1: { type: "string", defaultValue: "" },
    option2: { type: "string", defaultValue: "" },
  },
  outputs: {
    choice: { type: "string" },
    reasoning: { type: "string" },
  },
  resolvePorts: (params) => {
    const n = clampN(params.N);
    const inputs: Record<
      string,
      {
        type: string;
        userOnly?: boolean;
        defaultValue?: unknown;
        customProps?: Record<string, unknown>;
      }
    > = {
      client: { type: AI_CLIENT_TYPE },
      prompt: { type: "string", defaultValue: "", customProps: { rows: 5 } },
      data: { type: "string", defaultValue: "", customProps: { rows: 5 } },
      N: {
        type: "number",
        userOnly: true,
        defaultValue: MIN_N,
      },
    };
    for (let i = 1; i <= n; i++) {
      inputs[`option${i}`] = { type: "string", defaultValue: "" };
    }
    return {
      inputs,
      outputs: {
        choice: { type: "string" },
        reasoning: { type: "string" },
      },
    };
  },
  execute: (inputs) => {
    const client = asPublicAiClient(inputs.client);
    if (client.disable) {
      return { choice: null, reasoning: null };
    }
    const prompt = asString(inputs.prompt).trim();
    const data = asString(inputs.data);
    const n = clampN(inputs.N);
    const options: string[] = [];
    for (let i = 1; i <= n; i++) {
      const opt = asString(inputs[`option${i}`]).trim();
      if (!opt) throw new Error(`option${i} is empty`);
      options.push(opt);
    }

    // JSON.stringify so embedded newlines are unambiguous for the model.
    const optionList = options
      .map((o, i) => `${i + 1}. ${JSON.stringify(o)}`)
      .join("\n");
    const system = `You classify input into exactly one of the provided options.
Respond with JSON only, no markdown, of the form:
{"reasoning":"<brief reason>", "choice":"<exact option string>"}
The "choice" value must match one option exactly. If an option contains newlines, put real newlines inside the JSON string (or \\n escapes)—do not change the option text.`;

    const user = [
      prompt ? `Instructions:\n${prompt}` : "Instructions: (none)",
      "",
      "Options (JSON strings — copy choice from these):",
      optionList,
      "",
      "Data:",
      data || "(empty)",
    ].join("\n");

    const { content } = publicAiChatCompletionsSync({
      apiKey: client.apiKey,
      model: client.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    return parseChoiceJson(content, options);
  },
};

const realizeNewlinesNode: NodeSpec = {
  typeId: "ai/realize-newlines",
  displayName: "Realize newlines",
  description:
    "Convert literal escape sequences (\\n, \\r\\n, \\r) in the text into real newlines. Useful when a model or source emits backslash-n instead of line breaks.",
  color: TEXT_COLOR,
  group: ["AI", "Text"],
  inputs: {
    text: {
      type: "string",
      defaultValue: "",
      customProps: { rows: 3 },
    },
  },
  outputs: {
    text: { type: "string" },
  },
  execute: (inputs) => ({
    text: realizeNewlines(asString(inputs.text)),
  }),
};

export const aiNodes: NodeSpecRegistry = {
  [publicAiClient.typeId]: publicAiClient,
  [choose.typeId]: choose,
  [realizeNewlinesNode.typeId]: realizeNewlinesNode,
};

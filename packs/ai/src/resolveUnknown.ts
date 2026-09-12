import type { ExecuteContext } from "@nodish/core";
import { isAbortError } from "@nodish/core";
import { parseChoiceJson, publicAiChatCompletions } from "./publicai";
import { asPublicAiClient, type PublicAiClient } from "./types";
import {
  asTemplateName,
  clampMaxCalls,
  DROP_SENTINEL,
  formatUnknownActions,
  resolveUnknownParamRulesAsync,
  resolveUnknownParametersInContent,
  type UnknownParamChooser,
  type UnknownParamChooserInput,
} from "../../../pack/unknownParams.ts";

function buildUnknownParamMessages(input: UnknownParamChooserInput): {
  system: string;
  user: string;
} {
  const optionList = input.options
    .map((o, i) => `${i + 1}. ${JSON.stringify(o)}`)
    .join("\n");
  const relevantGroups = input.conflictGroups.filter(
    (g) =>
      g.length > 0 &&
      (g.includes(input.unknownKey) ||
        g.some((name) => input.siblingKeys.includes(name))),
  );
  const groups = relevantGroups.map((g) => `- ${g.join("; ")}`).join("\n");
  const system = `You classify an unknown MediaWiki template parameter into exactly one of the provided options.
Respond with JSON only, no markdown, of the form:
{"reasoning":"<brief reason>", "choice":"<exact option string>"}
The "choice" value must match one option exactly.
Use ${JSON.stringify(DROP_SENTINEL)} to drop the parameter when it is not a typo or alias of an eligible known name.`;

  const user = [
    `Template: ${input.templateName}`,
    `Unknown parameter: ${JSON.stringify(input.unknownKey)}`,
    `Value: ${input.value || "(empty)"}`,
    `Sibling parameters: ${input.siblingKeys.join(", ") || "(none)"}`,
    "Conflict groups:",
    groups || "(none)",
    "",
    "Options (JSON strings — copy choice from these):",
    optionList,
  ].join("\n");

  return { system, user };
}

async function chooseUnknownParam(
  input: UnknownParamChooserInput,
  complete: (system: string, user: string) => Promise<string>,
): Promise<string> {
  const { system, user } = buildUnknownParamMessages(input);
  try {
    const raw = await complete(system, user);
    return parseChoiceJson(raw, input.options).choice;
  } catch (err) {
    if (isAbortError(err)) throw err;
    return DROP_SENTINEL;
  }
}

function publicAiUnknownChooser(
  client: PublicAiClient,
  signal: AbortSignal,
): UnknownParamChooser {
  return (input) =>
    chooseUnknownParam(input, async (system, user) => {
      const { content } = await publicAiChatCompletions({
        apiKey: client.apiKey,
        model: client.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        signal,
      });
      return content;
    });
}

function asContent(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string content");
  }
  return value;
}

export async function resolveUnknownParametersExecute(
  inputs: Record<string, unknown>,
  ctx: ExecuteContext,
): Promise<{ content: string; reasoning: string }> {
  const client = asPublicAiClient(inputs.client);
  const content = asContent(inputs.content);
  if (client.disable) {
    return { content, reasoning: "(none)" };
  }
  const name = asTemplateName(inputs.name);
  const maxCalls = clampMaxCalls(inputs.maxCalls, 8);
  const rules = await resolveUnknownParamRulesAsync(name, ctx.signal);
  const result = await resolveUnknownParametersInContent(
    content,
    rules,
    publicAiUnknownChooser(client, ctx.signal),
    maxCalls,
  );
  return {
    content: result.content,
    reasoning: formatUnknownActions(result.actions),
  };
}

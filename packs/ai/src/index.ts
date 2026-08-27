import { defineType, type NodePack } from "@nodish/core";
import { aiNodes } from "./nodes";
import PasswordWidget from "./PasswordWidget.vue";
import { AiClient, AiSecret } from "./types";

export const pack: NodePack = {
  id: "pillbug/ai",
  types: {
    [AiSecret.id]: defineType(AiSecret),
    [AiClient.id]: defineType(AiClient),
  },
  nodeTypes: {
    ...aiNodes,
  },
  setup(ctx) {
    ctx.registerComponentWidget("ai-password", PasswordWidget);
  },
};

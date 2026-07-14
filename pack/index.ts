import type { NodePack } from "@nodish/core";
import { defineType } from "@nodish/core";
import { mediaWikiNodes } from "./MediaWiki.js";
import { Title, titleNodes } from "./Title.js";

export const pack: NodePack = {
  id: "pillbug/mwn",
  types: {
    [Title.id]: defineType(Title),
  },
  nodeTypes: {
    ...titleNodes,
    ...mediaWikiNodes,
  },
};

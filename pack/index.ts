import type { NodePack } from "@nodish/core";
import { defineType } from "@nodish/core";
import { mediaWikiNodes } from "./MediaWiki.js";
import { Templates } from "./Templates.js";
import { Title, titleNodes } from "./Title.js";

export const pack: NodePack = {
  id: "pillbug/wiki",
  types: {
    [Title.id]: defineType(Title),
    [Templates.id]: defineType(Templates),
  },
  nodeTypes: {
    ...titleNodes,
    ...mediaWikiNodes,
  },
};

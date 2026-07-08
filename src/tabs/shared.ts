import { reactive, ref } from "vue";
import type { NodeMap } from "@nodish/core";
import { createProcessMap, createSkipMap } from "../nodish/createAppNodeMap";

/** Transforms page wikitext: Title + Content → ContentAfter */
export const map = ref(reactive(createProcessMap()) as NodeMap);

/** Fast predicate: Title + Content → Skip (true skips process graph) */
export const skipMap = ref(reactive(createSkipMap()) as NodeMap);

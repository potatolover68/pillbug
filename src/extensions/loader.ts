import { reactive } from "vue";
import { importGraph, serializeDocument, type NodeMap } from "@nodish/core";
import { pack as basePack } from "@nodish/base";
import { pack as mwnPack } from "../../pack/index";

import { createProcessMap, createSkipMap } from "../nodish/createAppNodeMap";
import { map, skipMap } from "../tabs/shared";
import {
  clearPreviewInputsFromMaps,
  syncPreviewInputs,
} from "../tabs/code/state";
import { getEnabledExtensions, importPackModule } from "./store";

function loadBuiltin(target: NodeMap): void {
  const baseErrors = target.loadPack(basePack);
  if (baseErrors.length > 0) {
    throw new Error(`Failed to load built-in pack: ${baseErrors.join(", ")}`);
  }
  const mwnErrors = target.loadPack(mwnPack);
  if (mwnErrors.length > 0) {
    throw new Error(`Failed to load mwn pack: ${mwnErrors.join(", ")}`);
  }
}

export async function rebuildMaps(): Promise<void> {
  clearPreviewInputsFromMaps();
  const processDoc = serializeDocument(map.value);
  const skipDoc = serializeDocument(skipMap.value);

  const nextMap = createProcessMap();
  const nextSkipMap = createSkipMap();

  loadBuiltin(nextMap);
  loadBuiltin(nextSkipMap);

  const extensions = await getEnabledExtensions();
  for (const extension of extensions) {
    const pack = await importPackModule(extension.url);
    const processErrors = nextMap.loadPack(pack);
    const skipErrors = nextSkipMap.loadPack(pack);
    const errors = [...processErrors, ...skipErrors];
    if (errors.length > 0) {
      throw new Error(
        `Failed to load extension ${extension.id}: ${errors.join(", ")}`,
      );
    }
  }

  importGraph(nextMap, processDoc);
  importGraph(nextSkipMap, skipDoc);

  // Keep maps deeply reactive so NodeViewer drag updates re-render live.
  map.value = reactive(nextMap) as NodeMap;
  skipMap.value = reactive(nextSkipMap) as NodeMap;
  syncPreviewInputs();
}

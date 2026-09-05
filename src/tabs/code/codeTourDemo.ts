import {
  boundaryNodes,
  importGraph,
  instantiate,
  serializeDocument,
  type Connection,
  type DefiniteNode,
  type GraphDocument,
  type NodeMap,
  type Port,
} from "@nodish/core";
import { map, skipMap } from "../shared/maps";
import {
  capturePreviewState,
  clearPreviewInputsFromMaps,
  restorePreviewState,
  setPreviewContentForTour,
  syncPreviewInputs,
  type PreviewState,
} from "./state";

const SAMPLE_CONTENT = `{{Infobox person
| name = Example Person
| Date = 1 January 2000
}}

Teh quick brown fox jumps over the lazy dog.
`;

type CodeTourSnapshot = {
  process: GraphDocument;
  skip: GraphDocument;
  preview: PreviewState;
};

let codeTourSnapshot: CodeTourSnapshot | null = null;

function portByName(
  node: DefiniteNode,
  name: string,
  direction: Port["direction"],
): Port | null {
  const bag = direction === "input" ? node.inputs : node.outputs;
  for (const port of Object.values(bag)) {
    if (port.name === name) return port;
  }
  return null;
}

function setInputValue(node: DefiniteNode, name: string, value: unknown): void {
  const port = portByName(node, name, "input");
  if (port) port.value = value;
}

function wire(
  fromNode: DefiniteNode,
  fromPortName: string,
  toNode: DefiniteNode,
  toPortName: string,
): Connection | null {
  const fromPort = portByName(fromNode, fromPortName, "output");
  const toPort = portByName(toNode, toPortName, "input");
  if (!fromPort || !toPort) return null;
  return {
    id: crypto.randomUUID(),
    from: { node: fromNode.id, port: fromPort.id },
    to: { node: toNode.id, port: toPort.id },
  };
}

function cloneNode(node: DefiniteNode): DefiniteNode {
  return JSON.parse(JSON.stringify(node)) as DefiniteNode;
}

function tryInstantiate(
  nodeMap: NodeMap,
  typeId: string,
  location: { x: number; y: number },
): DefiniteNode | null {
  const def = nodeMap.nodeTypes[typeId];
  if (!def) return null;
  return instantiate(def, location);
}

function buildProcessDemo(nodeMap: NodeMap): GraphDocument | null {
  const { input, output } = boundaryNodes(nodeMap);
  const rename = tryInstantiate(nodeMap, "wiki/page-rename-parameter", {
    x: 280,
    y: 100,
  });
  const retf = tryInstantiate(nodeMap, "wiki/regex-typo-fixing", {
    x: 560,
    y: 100,
  });

  if (!rename && !retf) return null;

  const inputNode = cloneNode(input);
  inputNode.location = { x: 40, y: 120 };
  const outputNode = cloneNode(output);
  outputNode.location = { x: 840, y: 120 };

  const nodes: DefiniteNode[] = [inputNode];
  const connections: Connection[] = [];

  if (rename) {
    setInputValue(rename, "name", "infobox golf tournament");
    setInputValue(rename, "oldParameter", "map");
    setInputValue(rename, "newParameter", "pushpin_map");
    nodes.push(rename);
  }
  if (retf) nodes.push(retf);
  nodes.push(outputNode);

  if (rename && retf) {
    const a = wire(inputNode, "Content", rename, "content");
    const b = wire(rename, "content", retf, "content");
    const c = wire(retf, "content", outputNode, "ContentAfter");
    for (const conn of [a, b, c]) {
      if (conn) connections.push(conn);
    }
  } else if (rename) {
    const a = wire(inputNode, "Content", rename, "content");
    const b = wire(rename, "content", outputNode, "ContentAfter");
    for (const conn of [a, b]) {
      if (conn) connections.push(conn);
    }
  } else if (retf) {
    const a = wire(inputNode, "Content", retf, "content");
    const b = wire(retf, "content", outputNode, "ContentAfter");
    for (const conn of [a, b]) {
      if (conn) connections.push(conn);
    }
  }

  return {
    graph: { nodes, connections },
    interface: serializeDocument(nodeMap).interface,
  };
}

function buildSkipDemo(nodeMap: NodeMap): GraphDocument | null {
  const { input, output } = boundaryNodes(nodeMap);
  const hasTemplate = tryInstantiate(nodeMap, "wiki/content-has-template", {
    x: 320,
    y: 100,
  });
  if (!hasTemplate) return null;

  setInputValue(hasTemplate, "name", "Under construction");

  const inputNode = cloneNode(input);
  inputNode.location = { x: 40, y: 120 };
  const outputNode = cloneNode(output);
  outputNode.location = { x: 600, y: 120 };

  const connections: Connection[] = [];
  const a = wire(inputNode, "Content", hasTemplate, "content");
  const b = wire(hasTemplate, "result", outputNode, "Skip");
  if (a) connections.push(a);
  if (b) connections.push(b);

  return {
    graph: {
      nodes: [inputNode, hasTemplate, outputNode],
      connections,
    },
    interface: serializeDocument(nodeMap).interface,
  };
}

/** Seed demo process/skip graphs for the Code tour; call endCodeTourDemo on exit. */
export function beginCodeTourDemo(): void {
  if (codeTourSnapshot) endCodeTourDemo();

  const preview = capturePreviewState();
  clearPreviewInputsFromMaps();

  codeTourSnapshot = {
    process: serializeDocument(map.value),
    skip: serializeDocument(skipMap.value),
    preview,
  };

  const processDemo = buildProcessDemo(map.value);
  if (processDemo) {
    importGraph(map.value, processDemo);
  }

  const skipDemo = buildSkipDemo(skipMap.value);
  if (skipDemo) {
    importGraph(skipMap.value, skipDemo);
  }

  setPreviewContentForTour(SAMPLE_CONTENT, "Tour:Example");
}

/** Restore process/skip graphs and preview from before beginCodeTourDemo. */
export function endCodeTourDemo(): void {
  const snap = codeTourSnapshot;
  if (!snap) return;
  codeTourSnapshot = null;

  importGraph(map.value, snap.process);
  importGraph(skipMap.value, snap.skip);
  restorePreviewState(snap.preview);
  syncPreviewInputs();
}

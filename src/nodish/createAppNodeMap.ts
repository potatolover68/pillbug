import {
  OUTPUT_TYPE,
  createNodeMap,
  importGraph,
  type CreateNodeMapInit,
  type GraphDocument,
  type GraphInterface,
  type NodeMap,
} from "@nodish/core";

const reasoningReturn = {
  type: "string" as const,
  connectionOnly: true,
  defaultValue: null,
  label: "Reasoning",
};

const processGraphInterface: GraphInterface = {
  parameters: {
    Title: { type: "wiki/title" },
    Content: { type: "string" },
  },
  returns: {
    ContentAfter: { type: "string" },
    Reasoning: reasoningReturn,
  },
};

const skipGraphInterface: GraphInterface = {
  parameters: {
    Title: { type: "wiki/title" },
    Content: { type: "string" },
  },
  returns: {
    Skip: { type: "boolean" },
  },
};

function isolateRegistry<T extends object>(registry: T): T {
  return Object.assign(Object.create(null) as T, registry);
}

function createAppNodeMap(init?: CreateNodeMapInit): NodeMap {
  const nodeMap = createNodeMap({
    ...init,
    graphInterface: init?.graphInterface ?? processGraphInterface,
  });
  nodeMap.types = isolateRegistry(nodeMap.types);
  nodeMap.nodeTypes = isolateRegistry(nodeMap.nodeTypes);
  return nodeMap;
}

export function createProcessMap(init?: CreateNodeMapInit): NodeMap {
  return createAppNodeMap({
    ...init,
    graphInterface: processGraphInterface,
  });
}

export function createSkipMap(init?: CreateNodeMapInit): NodeMap {
  return createAppNodeMap({
    ...init,
    graphInterface: skipGraphInterface,
  });
}

/**
 * Old saved process graphs serialized a ContentAfter-only Output.
 * Merge the Reasoning return so the socket exists after importGraph.
 */
export function ensureProcessGraphInterface(map: NodeMap): void {
  const existing = map.graphInterface.returns?.Reasoning;
  map.graphInterface = {
    ...map.graphInterface,
    returns: {
      ...map.graphInterface.returns,
      Reasoning: {
        ...reasoningReturn,
        ...existing,
        type: "string",
        connectionOnly: true,
        defaultValue: existing?.defaultValue ?? null,
        label: existing?.label ?? "Reasoning",
      },
    },
  };

  const outputType = map.nodeTypes[OUTPUT_TYPE];
  if (outputType) {
    const hasTypePort =
      Boolean(outputType.inputs.Reasoning) ||
      Object.values(outputType.inputs).some((p) => p.name === "Reasoning");
    if (!hasTypePort) {
      outputType.inputs = {
        ...outputType.inputs,
        Reasoning: {
          name: "Reasoning",
          ...reasoningReturn,
        },
      };
    }
  }

  const outputNode = map.graph.nodes.find(
    (node) => node.typeId === OUTPUT_TYPE,
  );
  if (!outputNode) return;
  if (Object.values(outputNode.inputs).some((p) => p.name === "Reasoning")) {
    return;
  }
  const id = crypto.randomUUID();
  outputNode.inputs[id] = {
    id,
    name: "Reasoning",
    label: "Reasoning",
    type: "string",
    direction: "input",
    connectionOnly: true,
    value: null,
  };
}

/** importGraph then re-assert the current process Output interface. */
export function importProcessGraph(
  map: NodeMap,
  doc: GraphDocument,
): string[] {
  const errors = importGraph(map, doc);
  ensureProcessGraphInterface(map);
  return errors;
}

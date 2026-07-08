import {
  createNodeMap,
  type CreateNodeMapInit,
  type GraphInterface,
  type NodeMap,
} from "@nodish/core";

const processGraphInterface: GraphInterface = {
  parameters: {
    Title: { type: "mwn/title" },
    Content: { type: "string" },
  },
  returns: {
    ContentAfter: { type: "string" },
  },
};

const skipGraphInterface: GraphInterface = {
  parameters: {
    Title: { type: "mwn/title" },
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

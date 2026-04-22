import { test, expect, beforeEach, afterEach } from "vitest";
import { CanvasService } from "./canvas.js";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testVaultPath: string;
let svc: CanvasService;

beforeEach(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "mcpvault-canvas-test-"));
  svc = new CanvasService(testVaultPath);
});

afterEach(async () => {
  try { await rm(testVaultPath, { recursive: true }); } catch {}
});

test("read returns nodes, edges, nodeCount, edgeCount", async () => {
  await writeFile(
    join(testVaultPath, "test.canvas"),
    JSON.stringify({ nodes: [], edges: [] })
  );
  const result = await svc.read("test.canvas");
  expect(result.nodes).toEqual([]);
  expect(result.edges).toEqual([]);
  expect(result.nodeCount).toBe(0);
  expect(result.edgeCount).toBe(0);
});

test("read throws File not found for missing file", async () => {
  await expect(svc.read("nope.canvas")).rejects.toThrow("File not found");
});

test("read throws for invalid JSON", async () => {
  await writeFile(join(testVaultPath, "bad.canvas"), "not json");
  await expect(svc.read("bad.canvas")).rejects.toThrow("not valid JSON");
});

test("read throws for canvas missing nodes array", async () => {
  await writeFile(join(testVaultPath, "bad.canvas"), JSON.stringify({ edges: [] }));
  await expect(svc.read("bad.canvas")).rejects.toThrow("missing nodes array");
});

test("read throws for path traversal", async () => {
  await expect(svc.read("../../etc/passwd")).rejects.toThrow("Path traversal not allowed");
});

// Helper: write a canvas with a text node
async function writeCanvasWithNode(vaultPath: string, filename: string) {
  const data = {
    nodes: [{ id: "aabbccddeeff0011", type: "text", text: "hello", x: 0, y: 0, width: 250, height: 60 }],
    edges: []
  };
  await writeFile(join(vaultPath, filename), JSON.stringify(data));
  return data;
}

// addNode
test("addNode creates a text node and returns it with a generated id", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  const node = await svc.addNode("c.canvas", { type: "text", text: "hello", x: 10, y: 20 });
  expect(node.type).toBe("text");
  expect((node as any).text).toBe("hello");
  expect(node.x).toBe(10);
  expect(node.y).toBe(20);
  expect(node.width).toBe(250); // default
  expect(node.height).toBe(60); // default
  expect(node.id).toMatch(/^[0-9a-f]{16}$/);
});

test("addNode applies explicit width and height", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  const node = await svc.addNode("c.canvas", { type: "text", text: "x", x: 0, y: 0, width: 500, height: 200 });
  expect(node.width).toBe(500);
  expect(node.height).toBe(200);
});

test("addNode throws when text missing for text node", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  await expect(svc.addNode("c.canvas", { type: "text", x: 0, y: 0 }))
    .rejects.toThrow("text is required");
});

test("addNode creates a file node", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  const node = await svc.addNode("c.canvas", { type: "file", file: "notes/foo.md", x: 0, y: 0 });
  expect(node.type).toBe("file");
  expect((node as any).file).toBe("notes/foo.md");
});

test("addNode creates a group node", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  const node = await svc.addNode("c.canvas", { type: "group", label: "My Group", x: 0, y: 0 });
  expect(node.type).toBe("group");
  expect((node as any).label).toBe("My Group");
});

test("addNode creates a link node", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  const node = await svc.addNode("c.canvas", { type: "link", url: "https://example.com", x: 0, y: 0 });
  expect(node.type).toBe("link");
  expect((node as any).url).toBe("https://example.com");
});

test("addNode throws for invalid type", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  await expect(svc.addNode("c.canvas", { type: "invalid" as any, x: 0, y: 0 }))
    .rejects.toThrow("Invalid node type");
});

// updateNode
test("updateNode changes position and persists to file", async () => {
  await writeCanvasWithNode(testVaultPath, "c.canvas");
  const updated = await svc.updateNode("c.canvas", "aabbccddeeff0011", { x: 99, y: 88 });
  expect(updated.x).toBe(99);
  expect(updated.y).toBe(88);
  const reread = await svc.read("c.canvas");
  expect(reread.nodes[0].x).toBe(99);
});

test("updateNode throws for unknown node id", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  await expect(svc.updateNode("c.canvas", "deadbeef12345678", { x: 0 }))
    .rejects.toThrow("not found");
});

// removeNode
test("removeNode removes the node", async () => {
  await writeCanvasWithNode(testVaultPath, "c.canvas");
  await svc.removeNode("c.canvas", "aabbccddeeff0011");
  const result = await svc.read("c.canvas");
  expect(result.nodes).toHaveLength(0);
});

test("removeNode cascades to remove connected edges", async () => {
  const data = {
    nodes: [
      { id: "1111111111111111", type: "text", text: "a", x: 0, y: 0, width: 250, height: 60 },
      { id: "2222222222222222", type: "text", text: "b", x: 300, y: 0, width: 250, height: 60 },
    ],
    edges: [
      { id: "eeee111111111111", fromNode: "1111111111111111", toNode: "2222222222222222" }
    ]
  };
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify(data));
  await svc.removeNode("c.canvas", "1111111111111111");
  const result = await svc.read("c.canvas");
  expect(result.nodes).toHaveLength(1);
  expect(result.edges).toHaveLength(0);
});

test("removeNode throws for unknown node id", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  await expect(svc.removeNode("c.canvas", "deadbeef12345678"))
    .rejects.toThrow("not found");
});

// addEdge
test("addEdge connects two existing nodes", async () => {
  const data = {
    nodes: [
      { id: "1111111111111111", type: "text", text: "a", x: 0, y: 0, width: 250, height: 60 },
      { id: "2222222222222222", type: "text", text: "b", x: 300, y: 0, width: 250, height: 60 },
    ],
    edges: []
  };
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify(data));
  const edge = await svc.addEdge("c.canvas", {
    fromNode: "1111111111111111",
    toNode: "2222222222222222",
    fromSide: "right",
    toSide: "left",
    label: "connects"
  });
  expect(edge.fromNode).toBe("1111111111111111");
  expect(edge.toNode).toBe("2222222222222222");
  expect(edge.fromSide).toBe("right");
  expect(edge.toSide).toBe("left");
  expect(edge.label).toBe("connects");
  expect(edge.id).toMatch(/^[0-9a-f]{16}$/);
});

test("addEdge throws when fromNode does not exist", async () => {
  const data = {
    nodes: [{ id: "1111111111111111", type: "text", text: "a", x: 0, y: 0, width: 250, height: 60 }],
    edges: []
  };
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify(data));
  await expect(svc.addEdge("c.canvas", { fromNode: "deadbeef12345678", toNode: "1111111111111111" }))
    .rejects.toThrow("not found");
});

test("addEdge throws when toNode does not exist", async () => {
  const data = {
    nodes: [{ id: "1111111111111111", type: "text", text: "a", x: 0, y: 0, width: 250, height: 60 }],
    edges: []
  };
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify(data));
  await expect(svc.addEdge("c.canvas", { fromNode: "1111111111111111", toNode: "deadbeef12345678" }))
    .rejects.toThrow("not found");
});

// removeEdge
test("removeEdge removes the edge by id", async () => {
  const data = {
    nodes: [
      { id: "1111111111111111", type: "text", text: "a", x: 0, y: 0, width: 250, height: 60 },
      { id: "2222222222222222", type: "text", text: "b", x: 300, y: 0, width: 250, height: 60 },
    ],
    edges: [{ id: "eeee111111111111", fromNode: "1111111111111111", toNode: "2222222222222222" }]
  };
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify(data));
  await svc.removeEdge("c.canvas", "eeee111111111111");
  const result = await svc.read("c.canvas");
  expect(result.edges).toHaveLength(0);
});

test("removeEdge throws for unknown edge id", async () => {
  await writeFile(join(testVaultPath, "c.canvas"), JSON.stringify({ nodes: [], edges: [] }));
  await expect(svc.removeEdge("c.canvas", "deadbeef12345678"))
    .rejects.toThrow("not found");
});

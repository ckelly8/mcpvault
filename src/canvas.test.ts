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

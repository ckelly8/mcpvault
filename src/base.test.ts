import { test, expect, beforeEach, afterEach } from "vitest";
import { BaseService } from "./base.js";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testVaultPath: string;
let svc: BaseService;

beforeEach(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "mcpvault-base-test-"));
  svc = new BaseService(testVaultPath);
});

afterEach(async () => {
  try { await rm(testVaultPath, { recursive: true }); } catch {}
});

const SIMPLE_BASE = `views:\n  - type: table\n    name: Table\n`;

// read
test("read returns parsed views array", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  const result = await svc.read("test.base");
  expect(result.views).toHaveLength(1);
  expect(result.views[0].type).toBe("table");
  expect(result.views[0].name).toBe("Table");
});

test("read throws File not found for missing file", async () => {
  await expect(svc.read("nope.base")).rejects.toThrow("File not found");
});

test("read throws for invalid YAML", async () => {
  await writeFile(join(testVaultPath, "bad.base"), "views: [\nunclosed");
  await expect(svc.read("bad.base")).rejects.toThrow("not valid YAML");
});

test("read throws for missing views array", async () => {
  await writeFile(join(testVaultPath, "bad.base"), "source: foo\n");
  await expect(svc.read("bad.base")).rejects.toThrow("missing views array");
});

test("read throws for path traversal", async () => {
  await expect(svc.read("../../etc/passwd")).rejects.toThrow("Path traversal not allowed");
});

// write
test("write persists validated base data", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  await svc.write("test.base", { views: [{ type: "board", name: "Board" }] });
  const result = await svc.read("test.base");
  expect(result.views[0].type).toBe("board");
  expect(result.views[0].name).toBe("Board");
});

test("write throws for missing views array", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  await expect(svc.write("test.base", { notViews: [] }))
    .rejects.toThrow("missing views array");
});

test("write creates a new file when it does not exist", async () => {
  await svc.write("new.base", { views: [{ type: "table", name: "Fresh" }] });
  const result = await svc.read("new.base");
  expect(result.views[0].name).toBe("Fresh");
});

// addView
test("addView appends a new view", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  const view = await svc.addView("test.base", { type: "board", name: "Board" });
  expect(view.type).toBe("board");
  expect(view.name).toBe("Board");
  const result = await svc.read("test.base");
  expect(result.views).toHaveLength(2);
});

test("addView throws for duplicate view name", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  await expect(svc.addView("test.base", { type: "table", name: "Table" }))
    .rejects.toThrow("already exists");
});

test("addView throws for invalid view type", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  await expect(svc.addView("test.base", { type: "invalid" as any, name: "X" }))
    .rejects.toThrow("Invalid view type");
});

// removeView
test("removeView removes a view by name", async () => {
  const twoViews = `views:\n  - type: table\n    name: Table\n  - type: board\n    name: Board\n`;
  await writeFile(join(testVaultPath, "test.base"), twoViews);
  await svc.removeView("test.base", "Board");
  const result = await svc.read("test.base");
  expect(result.views).toHaveLength(1);
  expect(result.views[0].name).toBe("Table");
});

test("removeView throws when removing last view", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  await expect(svc.removeView("test.base", "Table"))
    .rejects.toThrow("Cannot remove the last view");
});

test("removeView throws when view name not found", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  await expect(svc.removeView("test.base", "NoSuchView"))
    .rejects.toThrow("not found");
});

// updateView
test("updateView deep-merges partial fields", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  const updated = await svc.updateView("test.base", "Table", { type: "gallery" });
  expect(updated.type).toBe("gallery");
  expect(updated.name).toBe("Table");
  const persisted = await svc.read("test.base");
  expect(persisted.views[0].type).toBe("gallery");
  expect(persisted.views[0].name).toBe("Table");
});

test("updateView throws for unknown view name", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  await expect(svc.updateView("test.base", "NoSuchView", { type: "board" }))
    .rejects.toThrow("not found");
});

test("updateView throws for invalid type in update", async () => {
  await writeFile(join(testVaultPath, "test.base"), SIMPLE_BASE);
  await expect(svc.updateView("test.base", "Table", { type: "invalid" as any }))
    .rejects.toThrow("Invalid view type");
});

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'path';
import { randomBytes } from 'node:crypto';

export interface CanvasTextNode {
  id: string; type: 'text'; x: number; y: number; width: number; height: number; text: string; color?: string;
}
export interface CanvasFileNode {
  id: string; type: 'file'; x: number; y: number; width: number; height: number; file: string; color?: string;
}
export interface CanvasGroupNode {
  id: string; type: 'group'; x: number; y: number; width: number; height: number; label?: string; color?: string;
}
export interface CanvasLinkNode {
  id: string; type: 'link'; x: number; y: number; width: number; height: number; url: string; color?: string;
}
export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasGroupNode | CanvasLinkNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'bottom' | 'left' | 'right';
  toSide?: 'top' | 'bottom' | 'left' | 'right';
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface AddNodeParams {
  type: 'text' | 'file' | 'group' | 'link';
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
  text?: string;
  file?: string;
  label?: string;
  url?: string;
}

export interface UpdateNodeParams {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  text?: string;
  file?: string;
  label?: string;
  url?: string;
}

export interface AddEdgeParams {
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'bottom' | 'left' | 'right';
  toSide?: 'top' | 'bottom' | 'left' | 'right';
  label?: string;
}

function generateId(): string {
  return randomBytes(8).toString('hex');
}

function validateCanvasData(data: unknown): asserts data is CanvasData {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid canvas: expected an object');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.nodes)) throw new Error('Invalid canvas: missing nodes array');
  if (!Array.isArray(d.edges)) throw new Error('Invalid canvas: missing edges array');
}

function defaultSize(type: string): { width: number; height: number } {
  if (type === 'text') return { width: 250, height: 60 };
  if (type === 'group') return { width: 400, height: 400 };
  if (type === 'link') return { width: 400, height: 300 };
  return { width: 400, height: 400 }; // file
}

function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export class CanvasService {
  constructor(private vaultPath: string) {}

  private resolvePath(relativePath: string): string {
    const normalizedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath.trim();
    const fullPath = resolve(join(this.vaultPath, normalizedPath));
    if (relative(this.vaultPath, fullPath).startsWith('..')) {
      throw new Error(`Path traversal not allowed: ${relativePath}`);
    }
    return fullPath;
  }

  private async load(path: string): Promise<CanvasData> {
    const fullPath = this.resolvePath(path);
    let raw: string;
    try {
      raw = await readFile(fullPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') throw new Error(`File not found: ${path}`);
      throw err;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid canvas file: not valid JSON`);
    }
    validateCanvasData(data);
    return data;
  }

  private async save(path: string, data: CanvasData): Promise<void> {
    validateCanvasData(data);
    const fullPath = this.resolvePath(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(data, null, '\t'), 'utf-8');
  }

  async read(path: string): Promise<CanvasData & { nodeCount: number; edgeCount: number }> {
    const data = await this.load(path);
    return { ...data, nodeCount: data.nodes.length, edgeCount: data.edges.length };
  }

  async addNode(path: string, params: AddNodeParams): Promise<CanvasNode> {
    const data = await this.load(path);
    const defaults = defaultSize(params.type);
    const base = {
      id: generateId(),
      x: params.x,
      y: params.y,
      width: params.width ?? defaults.width,
      height: params.height ?? defaults.height,
      ...(params.color !== undefined && { color: params.color }),
    };
    let node: CanvasNode;
    switch (params.type) {
      case 'text':
        if (!params.text) throw new Error('text is required for text nodes');
        node = { ...base, type: 'text', text: params.text };
        break;
      case 'file':
        if (!params.file) throw new Error('file is required for file nodes');
        node = { ...base, type: 'file', file: params.file };
        break;
      case 'group':
        node = { ...base, type: 'group', ...(params.label !== undefined && { label: params.label }) };
        break;
      case 'link':
        if (!params.url) throw new Error('url is required for link nodes');
        node = { ...base, type: 'link', url: params.url };
        break;
      default:
        throw new Error(`Invalid node type: ${(params as any).type}. Must be text, file, group, or link`);
    }
    await this.save(path, { ...data, nodes: [...data.nodes, node] });
    return node;
  }

  async updateNode(path: string, nodeId: string, params: UpdateNodeParams): Promise<CanvasNode> {
    const data = await this.load(path);
    const idx = data.nodes.findIndex(n => n.id === nodeId);
    if (idx === -1) throw new Error(`Node '${nodeId}' not found in ${path}`);
    const updated = { ...data.nodes[idx], ...omitUndefined(params) } as CanvasNode;
    const nodes = [...data.nodes];
    nodes[idx] = updated;
    await this.save(path, { ...data, nodes });
    return updated;
  }

  async removeNode(path: string, nodeId: string): Promise<void> {
    const data = await this.load(path);
    if (!data.nodes.some(n => n.id === nodeId)) throw new Error(`Node '${nodeId}' not found in ${path}`);
    await this.save(path, {
      nodes: data.nodes.filter(n => n.id !== nodeId),
      edges: data.edges.filter(e => e.fromNode !== nodeId && e.toNode !== nodeId),
    });
  }

  async addEdge(path: string, params: AddEdgeParams): Promise<CanvasEdge> {
    const data = await this.load(path);
    const nodeIds = new Set(data.nodes.map(n => n.id));
    if (!nodeIds.has(params.fromNode)) throw new Error(`Node '${params.fromNode}' not found in ${path}`);
    if (!nodeIds.has(params.toNode)) throw new Error(`Node '${params.toNode}' not found in ${path}`);
    const edge: CanvasEdge = {
      id: generateId(),
      fromNode: params.fromNode,
      toNode: params.toNode,
      ...(params.fromSide !== undefined && { fromSide: params.fromSide }),
      ...(params.toSide !== undefined && { toSide: params.toSide }),
      ...(params.label !== undefined && { label: params.label }),
    };
    await this.save(path, { ...data, edges: [...data.edges, edge] });
    return edge;
  }

  async removeEdge(path: string, edgeId: string): Promise<void> {
    const data = await this.load(path);
    if (!data.edges.some(e => e.id === edgeId)) throw new Error(`Edge '${edgeId}' not found in ${path}`);
    await this.save(path, { ...data, edges: data.edges.filter(e => e.id !== edgeId) });
  }
}

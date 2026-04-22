import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'path';
import { parse, stringify } from 'yaml';

export interface BaseView {
  type: 'table' | 'board' | 'calendar' | 'gallery';
  name: string;
  filters?: unknown;
  columns?: unknown;
  [key: string]: unknown;
}

export interface BaseData {
  views: BaseView[];
}

export interface AddViewParams {
  type: 'table' | 'board' | 'calendar' | 'gallery';
  name: string;
  filters?: unknown;
  columns?: unknown;
}

const VALID_VIEW_TYPES = new Set(['table', 'board', 'calendar', 'gallery']);

function validateBaseData(data: unknown): asserts data is BaseData {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid base: expected an object');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.views)) throw new Error('Invalid base: missing views array');
  for (const view of d.views as unknown[]) {
    if (typeof view !== 'object' || view === null) throw new Error('Invalid base: each view must be an object');
    const v = view as Record<string, unknown>;
    if (typeof v.type !== 'string') throw new Error('Invalid base: each view must have a string type');
    if (typeof v.name !== 'string') throw new Error('Invalid base: each view must have a string name');
  }
}

export class BaseService {
  constructor(private vaultPath: string) {}

  private resolvePath(relativePath: string): string {
    const normalizedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath.trim();
    const fullPath = resolve(join(this.vaultPath, normalizedPath));
    if (relative(this.vaultPath, fullPath).startsWith('..')) {
      throw new Error(`Path traversal not allowed: ${relativePath}`);
    }
    return fullPath;
  }

  private async load(path: string): Promise<BaseData> {
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
      data = parse(raw);
    } catch {
      throw new Error(`Invalid base file: not valid YAML`);
    }
    validateBaseData(data);
    return data;
  }

  private async save(path: string, data: BaseData): Promise<void> {
    validateBaseData(data);
    const fullPath = this.resolvePath(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, stringify(data), 'utf-8');
  }

  async read(path: string): Promise<BaseData> {
    return this.load(path);
  }

  async write(path: string, data: unknown): Promise<void> {
    validateBaseData(data);
    await this.save(path, data as BaseData);
  }

  async addView(path: string, params: AddViewParams): Promise<BaseView> {
    const data = await this.load(path);
    if (!VALID_VIEW_TYPES.has(params.type)) {
      throw new Error(`Invalid view type: ${params.type}. Must be table, board, calendar, or gallery`);
    }
    if (data.views.some(v => v.name === params.name)) {
      throw new Error(`View '${params.name}' already exists in ${path}`);
    }
    const view: BaseView = {
      type: params.type,
      name: params.name,
      ...(params.filters !== undefined && { filters: params.filters }),
      ...(params.columns !== undefined && { columns: params.columns }),
    };
    await this.save(path, { ...data, views: [...data.views, view] });
    return view;
  }

  async removeView(path: string, viewName: string): Promise<void> {
    const data = await this.load(path);
    if (!data.views.some(v => v.name === viewName)) {
      throw new Error(`View '${viewName}' not found in ${path}`);
    }
    if (data.views.length === 1) {
      throw new Error(`Cannot remove the last view from ${path}. A base must have at least one view.`);
    }
    await this.save(path, { ...data, views: data.views.filter(v => v.name !== viewName) });
  }

  async updateView(path: string, viewName: string, partialUpdate: Partial<BaseView>): Promise<BaseView> {
    const data = await this.load(path);
    const idx = data.views.findIndex(v => v.name === viewName);
    if (idx === -1) throw new Error(`View '${viewName}' not found in ${path}`);
    if (partialUpdate.type !== undefined && !VALID_VIEW_TYPES.has(partialUpdate.type)) {
      throw new Error(`Invalid view type: ${partialUpdate.type}. Must be table, board, calendar, or gallery`);
    }
    const updated: BaseView = { ...data.views[idx], ...partialUpdate };
    const views = [...data.views];
    views[idx] = updated;
    await this.save(path, { ...data, views });
    return updated;
  }
}

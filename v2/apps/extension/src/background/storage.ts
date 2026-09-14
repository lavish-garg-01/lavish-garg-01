export interface StorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export class ChromeStorageArea implements StorageArea {
  constructor(private readonly area: chrome.storage.StorageArea) {}
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> { return this.area.get(keys); }
  set(items: Record<string, unknown>): Promise<void> { return this.area.set(items); }
  remove(keys: string | string[]): Promise<void> { return this.area.remove(keys); }
}

export class MemoryStorageArea implements StorageArea {
  readonly values: Record<string, unknown> = {};
  async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    if (!keys) return structuredClone(this.values);
    const selected = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
    return Object.fromEntries(selected.filter((key) => key in this.values).map((key) => [key, structuredClone(this.values[key])]));
  }
  async set(items: Record<string, unknown>): Promise<void> { Object.assign(this.values, structuredClone(items)); }
  async remove(keys: string | string[]): Promise<void> { for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key]; }
}

import type { StorageArea } from "./storage.js";

const key = "jobHunter.extension.messageReceipts.v1";
const maximum = 500;

export class MessageReceiptStore {
  private queue = Promise.resolve();
  constructor(private readonly storage: StorageArea) {}
  claim(messageId: string): Promise<boolean> {
    const operation = this.queue.catch(() => undefined).then(async () => {
      const current = (await this.storage.get(key))[key];
      const values = Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : [];
      if (values.includes(messageId)) return false;
      await this.storage.set({ [key]: [...values.slice(-(maximum - 1)), messageId] });
      return true;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

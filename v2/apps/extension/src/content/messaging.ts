import { ContentCommandAckSchema, ContentCommandSchema, createRequest, ExtensionResponseSchema, type ExtensionRequest, type ExtensionResponse } from "../shared/contracts.js";
import { ExtensionRuntimeError, failure, safeFailure } from "../shared/errors.js";

type ContentRequest = Extract<ExtensionRequest, { source: "CONTENT" }>;

export class BackgroundMessenger {
  async send<T extends ExtensionRequest>(request: T): Promise<ExtensionResponse> {
    try {
      const raw: unknown = await chrome.runtime.sendMessage(request);
      return ExtensionResponseSchema.parse(raw);
    } catch (reason) {
      const invalidated = reason instanceof Error && /Extension context invalidated/i.test(reason.message);
      throw new ExtensionRuntimeError(failure(invalidated ? "EXTENSION_CONTEXT_INVALIDATED" : "MESSAGE_SCHEMA_INVALID", invalidated
        ? "The extension was updated. Reload this page to reconnect."
        : "The extension could not exchange a valid runtime message.", { retryable: true }));
    }
  }

  onCommand(handler: (command: ReturnType<typeof ContentCommandSchema.parse>) => Promise<void>): void {
    chrome.runtime.onMessage.addListener((raw: unknown, _sender, respond) => {
      const parsed = ContentCommandSchema.safeParse(raw);
      if (!parsed.success) return false;
      void handler(parsed.data).then(() => respond(ContentCommandAckSchema.parse({ accepted: true }))).catch((reason: unknown) => {
        const currentFailure = safeFailure(reason, parsed.data.correlationId ?? parsed.data.messageId);
        console.warn("[Job Hunter] content command failed", currentFailure.code, currentFailure.metadata.diagnosticCode ?? "");
        respond(ContentCommandAckSchema.parse({ accepted: false, failure: currentFailure }));
      });
      return true;
    });
  }

  request<T extends ContentRequest["type"]>(type: T, payload: Extract<ContentRequest, { type: T }>["payload"], options: { correlationId?: string | null; dataClass?: Extract<ContentRequest, { type: T }>["dataClass"] } = {}): Promise<ExtensionResponse> {
    try {
      // createRequest resolves its parameters through Extract<> on its own type parameter,
      // which stays deferred when T is forwarded from here. The schema still validates the
      // source/type pairing at runtime, so bind a T-concrete signature for the call.
      const create = createRequest as unknown as (
        type: T,
        source: "CONTENT",
        payload: unknown,
        options: { correlationId?: string | null; dataClass?: unknown }
      ) => ContentRequest;
      return this.send(create(type, "CONTENT", payload, options));
    } catch (reason) {
      const invalidated = reason instanceof Error && /Extension context invalidated/i.test(reason.message);
      throw new ExtensionRuntimeError(failure(invalidated ? "EXTENSION_CONTEXT_INVALIDATED" : "MESSAGE_SCHEMA_INVALID", invalidated
        ? "The extension was updated. Reload this page to reconnect."
        : "The extension could not exchange a valid runtime message.", { retryable: true }));
    }
  }
}

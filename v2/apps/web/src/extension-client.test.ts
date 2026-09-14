import assert from "node:assert/strict";
import test from "node:test";
import { isExtensionAvailableMessage, requiresSessionReconnect } from "./extension-client.js";

test("the website reconnects only for a valid extension availability event", () => {
  assert.equal(isExtensionAvailableMessage({
    source: "JOB_HUNTER_EXTENSION",
    type: "JOB_HUNTER_EXTENSION_AVAILABLE",
    extensionVersion: "2.0.0",
    protocolVersion: 1
  }), true);
  assert.equal(isExtensionAvailableMessage({
    source: "UNTRUSTED_PAGE",
    type: "JOB_HUNTER_EXTENSION_AVAILABLE",
    extensionVersion: "2.0.0",
    protocolVersion: 1
  }), false);
  assert.equal(isExtensionAvailableMessage({
    source: "JOB_HUNTER_EXTENSION",
    type: "JOB_HUNTER_EXTENSION_AVAILABLE",
    extensionVersion: "2.0.0",
    protocolVersion: 2
  }), false);
});

test("a click-time launch retries authentication only for missing or expired sessions", () => {
  assert.equal(requiresSessionReconnect("NOT_AUTHENTICATED"), true);
  assert.equal(requiresSessionReconnect("SESSION_EXPIRED"), true);
  assert.equal(requiresSessionReconnect("BACKEND_UNAVAILABLE"), false);
  assert.equal(requiresSessionReconnect("ERROR"), false);
  assert.equal(requiresSessionReconnect("READY"), false);
});

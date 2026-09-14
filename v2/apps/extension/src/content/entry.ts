import { isInjectableApplicationFrame } from "../shared/identity.js";
import { ContentRuntimeController } from "./controller.js";

interface RuntimeWindow extends Window {
  __JOB_HUNTER_CONTENT_RUNTIME_V2__?: ContentRuntimeController;
}

// Optional site access can be granted after an employer page is already open.
// The background worker may therefore inject this bundle to recover the tab.
// Keep injection idempotent so a later registered-script pass cannot create a
// second scanner, observer or message listener in the same frame.
const runtimeWindow = window as RuntimeWindow;
if (!isInjectableApplicationFrame(location.href, location.origin)) {
  // allFrames injection also hits opaque about:blank/sandboxed widgets.
  // Those frames cannot register a CONTENT_HELLO origin, so leave them idle.
} else if (!runtimeWindow.__JOB_HUNTER_CONTENT_RUNTIME_V2__) {
  const controller = new ContentRuntimeController();
  runtimeWindow.__JOB_HUNTER_CONTENT_RUNTIME_V2__ = controller;
  void controller.start();
}

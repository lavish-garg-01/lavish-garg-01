import assert from "node:assert/strict";
import test from "node:test";
import { applicationKeyFromEvidence, detectApplicationSurface, isInjectableApplicationFrame } from "./identity.js";

test("SmartRecruiters one-click routes work for every company, not expired sessions", () => {
  for (const company of ["BoschGroup", "ExampleEmployer"]) {
    const surface = detectApplicationSurface(new URL(`https://jobs.smartrecruiters.com/oneclick-ui/company/${company}/publication/a8554853-afb1-4bf7-a0ff-2a105bc92ce8`));
    assert.equal(surface.knownApplicationRoute, true);
    assert.equal(surface.applicationRoute, true);
  }
  assert.equal(detectApplicationSurface(new URL("https://jobs.smartrecruiters.com/oneclick-ui/session/expired")).knownApplicationRoute, false);
});

test("SmartRecruiters screening and review are known steps, not arbitrary suffixes", () => {
  const base = "https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/job-id";
  for (const suffix of ["/screening", "/screening/", "/review", "/summary", "/confirmation"]) {
    assert.equal(detectApplicationSurface(new URL(base + suffix)).knownApplicationRoute, true);
  }
  for (const suffix of ["/settings", "/login", "/unrelated"]) {
    assert.equal(detectApplicationSurface(new URL(base + suffix)).knownApplicationRoute, false);
  }
});

test("Ashby /application URLs are known application surfaces without a form", () => {
  const url = new URL("https://jobs.ashbyhq.com/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656/application");
  const surface = detectApplicationSurface(url);
  assert.equal(surface.ats, "ASHBY");
  assert.equal(surface.applicationRoute, true);
  assert.equal(surface.knownApplicationRoute, true);
  assert.ok(applicationKeyFromEvidence({
    origin: url.origin,
    applicationPath: url.pathname,
    actionEvidence: "",
    applicationFormCount: 0,
    standaloneControlCount: 0,
    applicationRoute: surface.applicationRoute,
    knownApplicationRoute: surface.knownApplicationRoute
  }));
});

test("Ashby job postings without /application are not applications yet", () => {
  const url = new URL("https://jobs.ashbyhq.com/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656");
  const surface = detectApplicationSurface(url);
  assert.equal(surface.ats, "ASHBY");
  assert.equal(surface.knownApplicationRoute, false);
  assert.equal(applicationKeyFromEvidence({
    origin: url.origin,
    applicationPath: url.pathname,
    actionEvidence: "",
    applicationFormCount: 0,
    standaloneControlCount: 0,
    applicationRoute: surface.applicationRoute,
    knownApplicationRoute: surface.knownApplicationRoute
  }), null);
});

test("generic /application paths are applications even before fields render", () => {
  const url = new URL("http://127.0.0.1:43101/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656/application");
  const surface = detectApplicationSurface(url);
  assert.equal(surface.knownApplicationRoute, true);
  assert.ok(applicationKeyFromEvidence({
    origin: url.origin,
    applicationPath: url.pathname,
    actionEvidence: "",
    applicationFormCount: 0,
    standaloneControlCount: 0,
    applicationRoute: surface.applicationRoute,
    knownApplicationRoute: surface.knownApplicationRoute
  }));
});

test("ordinary pages and search-only forms do not create an application key", () => {
  const docs = detectApplicationSurface(new URL("http://127.0.0.1:43101/ordinary"));
  assert.equal(docs.knownApplicationRoute, false);
  assert.equal(applicationKeyFromEvidence({
    origin: "http://127.0.0.1:43101",
    applicationPath: "/ordinary",
    actionEvidence: "",
    applicationFormCount: 0,
    standaloneControlCount: 1,
    applicationRoute: docs.applicationRoute,
    knownApplicationRoute: docs.knownApplicationRoute
  }), null);
  assert.equal(applicationKeyFromEvidence({
    origin: "https://example.test",
    applicationPath: "/careers/apply",
    actionEvidence: "",
    applicationFormCount: 0,
    standaloneControlCount: 0,
    applicationRoute: true,
    knownApplicationRoute: false
  }), null);
});

test("opaque and non-HTTP frames are not injectable application runtimes", () => {
  assert.equal(isInjectableApplicationFrame("https://jobs.ashbyhq.com/plane/job/application", "https://jobs.ashbyhq.com"), true);
  assert.equal(isInjectableApplicationFrame("http://127.0.0.1:3000/", "http://127.0.0.1:3000"), true);
  assert.equal(isInjectableApplicationFrame("about:blank", "null"), false);
  assert.equal(isInjectableApplicationFrame("about:blank", "https://jobs.ashbyhq.com"), false);
  assert.equal(isInjectableApplicationFrame("https://jobs.ashbyhq.com/application", "null"), false);
});

test("Lever apply URLs and native application forms remain application surfaces", () => {
  const lever = detectApplicationSurface(new URL("https://jobs.lever.co/acme/abcd/apply"));
  assert.equal(lever.ats, "LEVER");
  assert.equal(lever.knownApplicationRoute, true);
  assert.ok(applicationKeyFromEvidence({
    origin: "https://jobs.example",
    applicationPath: "/submit",
    actionEvidence: "/submit",
    applicationFormCount: 1,
    standaloneControlCount: 0,
    applicationRoute: false,
    knownApplicationRoute: false
  }));
});

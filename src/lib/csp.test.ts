import test from "node:test";
import assert from "node:assert/strict";
import { buildCsp, cspHeaderName } from "./csp";

test("buildCsp carries the nonce and no wildcard script source", () => {
  const csp = buildCsp("abc123");
  assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'(;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*(\*|unsafe-inline|unsafe-eval)/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /object-src/);
});

test("buildCsp allows eval only in development", () => {
  assert.match(buildCsp("n", { dev: true }), /'unsafe-eval'/);
  assert.doesNotMatch(buildCsp("n"), /unsafe-eval/);
});

test("cspHeaderName reports only until CSP_MODE=enforce", () => {
  const was = process.env.CSP_MODE;
  delete process.env.CSP_MODE;
  assert.equal(cspHeaderName(), "Content-Security-Policy-Report-Only");
  process.env.CSP_MODE = "enforce";
  assert.equal(cspHeaderName(), "Content-Security-Policy");
  if (was === undefined) delete process.env.CSP_MODE;
  else process.env.CSP_MODE = was;
});

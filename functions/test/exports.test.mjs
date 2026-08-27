import assert from "node:assert/strict";
import test from "node:test";
import { createCodOrder, getPublicStore, ownerApi } from "../index.mjs";

test("KDB Firebase callable Functions export public, COD, and owner entry points", () => {
  assert.equal(typeof getPublicStore, "function");
  assert.equal(typeof createCodOrder, "function");
  assert.equal(typeof ownerApi, "function");
});

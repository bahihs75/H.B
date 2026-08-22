import test from "node:test";
import assert from "node:assert/strict";
import { WILAYAS } from "../server/algeria-data.mjs";
import { OrderValidationError, validateOrderInput } from "../server/domain.mjs";

test("delivery source contains every Algerian wilaya", () => {
  assert.equal(WILAYAS.length, 58);
  assert.equal(WILAYAS[0].code, "01");
  assert.equal(WILAYAS.at(-1).code, "58");
});

test("domicile order requires a baladiya from the selected wilaya", () => {
  const valid = validateOrderInput({ fullName: "KDB Test Customer", phone: "0555000000", wilayaCode: "16", deliveryType: "domicile", baladiya: "القصبة" });
  assert.equal(valid.paymentMethod, "COD");
  assert.equal(valid.baladiya, "القصبة");
  assert.throws(() => validateOrderInput({ fullName: "KDB Test Customer", phone: "0555000000", wilayaCode: "16", deliveryType: "domicile", baladiya: "وهران" }), OrderValidationError);
});

test("stop desk order omits baladiya and remains COD-only", () => {
  const valid = validateOrderInput({ fullName: "KDB Test Customer", phone: "0555000000", wilayaCode: "31", deliveryType: "stop_desk" });
  assert.equal(valid.baladiya, null);
  assert.equal(valid.paymentMethod, "COD");
});

/**
 * ADR: KDB order validation
 *
 * Problem: COD orders need a minimal, reliable delivery payload without collecting
 * unnecessary email or payment data.
 * Decision: validate full name, phone, wilaya, delivery type and conditional
 * baladiya server-side. COD is assigned by the server and never accepted as a
 * customer-selectable payment input.
 * Consequence: the checkout remains concise while delivery operations receive
 * structured, trustworthy location data.
 */
import { WILAYAS, communesOf } from "./algeria-data.mjs";

const phonePattern = /^[0-9+(). -]{8,24}$/;
const deliveryTypes = new Set(["stop_desk", "domicile"]);

export class OrderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderValidationError";
  }
}

export function wilayaByCode(code) {
  return WILAYAS.find((wilaya) => wilaya.code === code) ?? null;
}

export function validateOrderInput(input) {
  const fullName = String(input.fullName ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const wilayaCode = String(input.wilayaCode ?? "");
  const deliveryType = String(input.deliveryType ?? "");
  const baladiya = String(input.baladiya ?? "").trim();

  if (fullName.length < 3) throw new OrderValidationError("Enter the customer’s full name.");
  if (!phonePattern.test(phone)) throw new OrderValidationError("Enter a valid phone number.");
  const wilaya = wilayaByCode(wilayaCode);
  if (!wilaya) throw new OrderValidationError("Select one of the 58 Algerian wilayas.");
  if (!deliveryTypes.has(deliveryType)) throw new OrderValidationError("Choose a delivery method.");
  if (deliveryType === "domicile") {
    if (!baladiya) throw new OrderValidationError("Select a baladiya for domicile delivery.");
    if (!communesOf(wilayaCode).includes(baladiya)) throw new OrderValidationError("The selected baladiya does not belong to this wilaya.");
  }

  return {
    fullName,
    phone,
    wilayaCode,
    wilayaName: wilaya.ar,
    deliveryType,
    baladiya: deliveryType === "domicile" ? baladiya : null,
    paymentMethod: "COD",
  };
}

export function validateCart(lines, products) {
  if (!Array.isArray(lines) || lines.length === 0) throw new OrderValidationError("Your bag is empty.");
  return lines.map((line) => {
    const product = products.find((item) => item.id === line.productId && item.status === "published");
    const quantity = Number(line.quantity);
    if (!product) throw new OrderValidationError("One product is no longer available.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(8, product.stock)) throw new OrderValidationError(`Quantity is unavailable for ${product.name}.`);
    return { productId: product.id, name: product.name, price: product.price, quantity, image: product.image };
  });
}

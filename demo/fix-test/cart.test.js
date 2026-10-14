import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "./cart.js";

const items = [
  { name: "Кофе", price: 300, qty: 2 },
  { name: "Круассан", price: 200, qty: 1 },
];

test("пустая корзина стоит 0", () => {
  assert.equal(total([]), 0);
});

test("учитывает количество товаров", () => {
  assert.equal(total(items), 800);
});

test("скидка считается в процентах", () => {
  assert.equal(total(items, 10), 720);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { addTodo, markDone } from "./storage.js";
import { formatTodo, formatList } from "./format.js";

test("addTodo выдаёт следующий id", () => {
  const todos = addTodo(addTodo([], "a"), "b");
  assert.deepEqual(todos.map((t) => t.id), [1, 2]);
});

test("markDone отмечает задачу", () => {
  const todos = markDone(addTodo([], "a"), 1);
  assert.equal(todos[0].done, true);
});

test("formatTodo показывает статус", () => {
  assert.equal(formatTodo({ id: 1, text: "a", done: true }), "[x] 1. a");
});

test("formatList для пустого списка", () => {
  assert.equal(formatList([]), "Список пуст");
});

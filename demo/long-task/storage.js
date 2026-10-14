import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function load(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

export function save(file, todos) {
  writeFileSync(file, JSON.stringify(todos, null, 2));
}

export function addTodo(todos, text) {
  const id = todos.length ? Math.max(...todos.map((t) => t.id)) + 1 : 1;
  return [...todos, { id, text, done: false }];
}

export function markDone(todos, id) {
  return todos.map((t) => (t.id === id ? { ...t, done: true } : t));
}

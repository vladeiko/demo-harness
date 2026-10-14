export function formatTodo(todo) {
  return `[${todo.done ? "x" : " "}] ${todo.id}. ${todo.text}`;
}

export function formatList(todos) {
  return todos.length ? todos.map(formatTodo).join("\n") : "Список пуст";
}

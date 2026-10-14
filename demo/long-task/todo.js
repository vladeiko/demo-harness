// Использование:
//   node todo.js add "купить молоко"
//   node todo.js list
//   node todo.js done 1
import { load, save, addTodo, markDone } from "./storage.js";
import { formatList } from "./format.js";

const FILE = "todos.json";
const [command, ...rest] = process.argv.slice(2);
let todos = load(FILE);

if (command === "add") {
  todos = addTodo(todos, rest.join(" "));
  save(FILE, todos);
  console.log("Добавлено");
} else if (command === "done") {
  todos = markDone(todos, Number(rest[0]));
  save(FILE, todos);
  console.log("Готово");
} else if (command === "list") {
  console.log(formatList(todos));
} else {
  console.log("Команды: add <текст>, list, done <id>");
}

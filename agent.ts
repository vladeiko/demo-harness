// Минимальный агент: языковая модель + цикл + инструменты.
// Запуск: node agent.ts            (диалог)
//         node agent.ts "задача"   (одна задача и выход)

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify, styleText } from "node:util";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";

const LLM_URL = process.env.LLM_URL ?? "http://localhost:8080/v1";
const { MODEL, API_KEY } = process.env; // нужны только для облачных API, llama-server обходится без них
const LOG_FILE = process.env.LOG; // если задан, сюда пишется вся переписка с моделью
const MAX_STEPS = 20; // сколько раз подряд модель может звать инструменты
const sh = promisify(exec);
const rl = createInterface({ input: process.stdin, output: process.stdout });

type Message = { role: "system" | "user" | "assistant"; content: string };
type Args = Record<string, string>;
type ToolCall = { name: string; args: Args };
type Tool = {
  description: string;
  params: Record<string, string>; // имя параметра -> описание
  confirm?: boolean; // спросить человека перед запуском
  run: (args: Args) => Promise<string>;
};

// ─── 1. Инструменты: обычные функции на TypeScript ─────────────────────────

const tools: Record<string, Tool> = {
  list_dir: {
    description: "List files and folders in a directory",
    params: { path: "Directory path, e.g. ." },
    run: async ({ path }) => {
      const entries = await readdir(path || ".", { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") || "(empty)";
    },
  },
  read_file: {
    description: "Read a text file",
    params: { path: "File path" },
    run: ({ path }) => readFile(path, "utf8"),
  },
  write_file: {
    description: "Create or overwrite a text file",
    params: { path: "File path", content: "Full file content" },
    confirm: true,
    run: async ({ path, content }) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      return `Wrote ${content.length} characters to ${path}`;
    },
  },
  run_command: {
    description: "Run a shell command and return its output",
    params: { command: "Shell command" },
    confirm: true,
    run: async ({ command }) => {
      // Упавшая команда (например, красные тесты) — тоже результат: модели нужен её вывод
      const { stdout, stderr, code } = await sh(command, { timeout: 60_000 }).catch((e) => e);
      return `${stdout}${stderr}${code ? `\nExit code: ${code}` : ""}` || "(no output)";
    },
  },
};

// ─── 2. Системный промпт: рассказываем модели про инструменты ──────────────
// Формат вызова тот же, на котором Qwen3.5 учили вызывать функции.

const toolsJson = Object.entries(tools).map(([name, t]) => ({
  name,
  description: t.description,
  parameters: {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(t.params).map(([p, d]) => [p, { type: "string", description: d }]),
    ),
    required: Object.keys(t.params),
  },
}));

const SYSTEM_PROMPT = `You are a coding agent working in the directory ${process.cwd()}.
Use the tools to look at and change files. When the task is done, reply to the user without calling tools.

# Tools

You have access to the following functions:

<tools>
${toolsJson.map((t) => JSON.stringify(t)).join("\n")}
</tools>

If you choose to call a function ONLY reply in the following format with NO suffix:

<tool_call>
<function=example_function_name>
<parameter=example_parameter_1>
value_1
</parameter>
</function>
</tool_call>

Reminder:
- Function calls MUST follow the specified format
- Required parameters MUST be specified
- You will get the result inside <tool_response></tool_response> tags`;

// ─── 3. Модель: один HTTP-запрос, на выходе просто текст ───────────────────

async function complete(messages: Message[]) {
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY ?? ""}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.6 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const { choices, usage } = await res.json();
  const message = choices[0].message;
  return {
    tokens: usage?.total_tokens ?? 0,
    thinking: message.reasoning_content ?? "",
    text: (message.content ?? "").replace(/<think>[\s\S]*?<\/think>/, "").trim(),
  };
}

// ─── 4. Парсер: ищем в тексте теги <tool_call> ────────────────────────────

function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const [, body] of text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)) {
    const name = body.match(/<function=([^>\s]+)>/)?.[1];
    if (!name) continue;
    const args: Args = {};
    for (const [, key, value] of body.matchAll(/<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g)) {
      args[key] = value;
    }
    calls.push({ name, args });
  }
  return calls;
}

async function runTool({ name, args }: ToolCall): Promise<string> {
  const tool = tools[name];
  if (!tool) return `Error: unknown tool "${name}"`;
  if (tool.confirm) {
    const answer = await rl.question(styleText("red", `  Разрешить ${name}? [y/N] `));
    if (answer.trim().toLowerCase() !== "y") return "Error: the user denied this action";
  }
  try {
    return (await tool.run(args)).slice(0, 10_000);
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

// ─── 5. Цикл агента: модель → инструменты → модель → … → ответ ─────────────

async function runAgent(messages: Message[]) {
  for (let step = 0; step < MAX_STEPS; step++) {
    let { tokens, thinking, text } = await complete(messages);
    if (thinking) console.log(styleText("gray", thinking.trim()));
    console.log(styleText("magenta", `[шаг ${step + 1}, контекст ${tokens} токенов]`));

    // Всё, что модель написала после последнего </tool_call>, — её фантазии о результате
    if (text.includes("</tool_call>")) text = text.slice(0, text.lastIndexOf("</tool_call>") + 12);
    messages.push({ role: "assistant", content: text });

    const calls = parseToolCalls(text);
    if (calls.length === 0 && !text.includes("<tool_call>")) {
      console.log(text); // инструменты не нужны — это финальный ответ
      return;
    }
    console.log(styleText("cyan", text));

    const results: string[] = [];
    if (calls.length === 0) {
      console.log(styleText("yellow", "Не смог разобрать вызов"));
      results.push("Error: could not parse the tool call, follow the format");
    }
    for (const call of calls) {
      const result = await runTool(call);
      console.log(styleText("yellow", result.slice(0, 500)));
      results.push(`<tool_response>\n${result}\n</tool_response>`);
    }
    // Результат возвращаем модели обычным сообщением — снова просто текст
    messages.push({ role: "user", content: results.join("\n") });
    if (LOG_FILE) writeFileSync(LOG_FILE, JSON.stringify({ messages }, null, 2));
  }
  console.log(styleText("red", `Остановился после ${MAX_STEPS} шагов`));
}

// ─── 6. Чат с человеком ───────────────────────────────────────────────────

const messages: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];

async function ask(input: string) {
  messages.push({ role: "user", content: input });
  try {
    await runAgent(messages);
  } catch (e) {
    console.log(styleText("red", `Ошибка: ${(e as Error).message}`));
  }
  if (LOG_FILE) writeFileSync(LOG_FILE, JSON.stringify({ messages }, null, 2));
}

const task = process.argv.slice(2).join(" ");
if (task) {
  await ask(task);
} else {
  while (true) {
    const input = (await rl.question(styleText("green", "\n> "))).trim();
    if (input === "exit") break;
    if (input) await ask(input);
  }
}
rl.close();

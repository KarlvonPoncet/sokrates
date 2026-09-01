#!/usr/bin/env node
import {
  Editor,
  HStack,
  Markdown,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  matchesKey,
  type EditorTheme,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { encodeMessage, MAX_WIRE_CHARS } from "./protocol.js";

const socketPath = process.env.SOKRATES_SOCKET;
const token = process.env.SOKRATES_TOKEN;
if (!socketPath || !token) {
  console.error("Missing Sokrates bridge identity.");
  process.exit(1);
}

const ansi = {
  accent: (s: string) => `\x1b[38;5;75m${s}\x1b[39m`,
  muted: (s: string) => `\x1b[38;5;245m${s}\x1b[39m`,
  dim: (s: string) => `\x1b[38;5;239m${s}\x1b[39m`,
  user: (s: string) => `\x1b[38;5;114m${s}\x1b[39m`,
  warning: (s: string) => `\x1b[38;5;214m${s}\x1b[39m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
  strike: (s: string) => `\x1b[9m${s}\x1b[29m`,
  underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
};

const markdownTheme: MarkdownTheme = {
  heading: ansi.accent,
  link: ansi.underline,
  linkUrl: ansi.dim,
  code: ansi.warning,
  codeBlock: (s) => s,
  codeBlockBorder: ansi.dim,
  quote: ansi.muted,
  quoteBorder: ansi.dim,
  hr: ansi.dim,
  listBullet: ansi.accent,
  bold: ansi.bold,
  italic: ansi.italic,
  strikethrough: ansi.strike,
  underline: ansi.underline,
};

const editorTheme: EditorTheme = {
  borderColor: ansi.accent,
  selectList: {
    selectedPrefix: ansi.accent,
    selectedText: ansi.accent,
    description: ansi.muted,
    scrollInfo: ansi.dim,
    noMatch: ansi.warning,
  },
};

interface ChatItem {
  id: string;
  role: "you" | "pi";
  text: string;
}

function safe(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x1b]/g, "");
}

let plan = "Waiting for plan…";
let chat: ChatItem[] = [];
let pendingId: string | undefined;
let status = "connecting";
let closed = false;

const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
const header = new Text("", 1, 0);
const planView = new Markdown(plan, 1, 0, markdownTheme);
const chatView = new Markdown("Ask a question to start.", 1, 0, markdownTheme);
const statusView = new Text("", 1, 0);
const editor = new Editor(tui, editorTheme, { paddingX: 1 });
const planScroll = new ScrollView(planView, { follow: "none", scrollbar: "auto" });
const chatScroll = new ScrollView(chatView, { follow: "end", primary: true, scrollbar: "auto" });

const body = new HStack([
  { component: new VStack([new Text(ansi.bold(ansi.accent(" PLAN")), 0, 0), planScroll]), grow: 1, minSize: 20 },
  { component: new VStack([new Text(ansi.bold(ansi.accent(" SPARRING")), 0, 0), chatScroll]), grow: 1, minSize: 20 },
], { gap: 2 });

const root = new VStack([
  { component: header, basis: "auto" },
  { component: body, basis: 0, grow: 1, minSize: 4 },
  { component: editor, basis: "auto", shrink: 1, minSize: 3 },
  { component: statusView, basis: "auto" },
]);

tui.setLayoutRoot(root);
tui.setFocus(editor);

function render(): void {
  header.setText(`${ansi.bold(ansi.accent("SOKRATES"))} ${ansi.dim("plan sparring · current Pi session")}`);
  planView.setText(safe(plan));
  const transcript = chat.slice(-30).map((item) => {
    const label = item.role === "you" ? ansi.user("YOU") : ansi.accent("PI");
    return `${label}\n\n${safe(item.text) || ansi.dim("…")}`;
  }).join("\n\n---\n\n");
  chatView.setText(transcript || "Ask a question to start.");
  statusView.setText(`${status === "thinking" ? ansi.warning("thinking") : ansi.muted(status)}  ${ansi.dim("Enter ask · Ctrl+D or /conclude · /plan replacement · Ctrl+C close")}`);
  tui.requestRender();
  if (status === "thinking") chatScroll.scrollToEnd();
}

function finish(): void {
  if (closed) return;
  closed = true;
  tui.stop();
  socket.end();
  setTimeout(() => process.exit(0), 20).unref();
}

const socket = connect(socketPath);
socket.setEncoding("utf8");
let buffer = "";

function requestConclusion(): void {
  if (pendingId || status === "connecting" || status === "requesting conclusion" || closed) return;
  const id = randomUUID();
  chat.push({ id, role: "you", text: "Conclude debate" });
  status = "requesting conclusion";
  editor.disableSubmit = true;
  socket.write(encodeMessage({ type: "conclude", id }));
  render();
}

socket.on("connect", () => socket.write(encodeMessage({ type: "auth", token })));
socket.on("data", (chunk: string) => {
  buffer += chunk;
  if (buffer.length > MAX_WIRE_CHARS) return finish();
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (message.type === "hello" && typeof message.plan === "string") {
      plan = message.plan;
      status = "ready";
    } else if (message.type === "plan" && typeof message.plan === "string") {
      plan = message.plan;
    } else if (message.type === "thinking" && typeof message.id === "string") {
      pendingId = message.id;
      status = "thinking";
      editor.disableSubmit = true;
      chat.push({ id: message.id, role: "pi", text: "" });
    } else if (message.type === "delta" && message.id === pendingId && typeof message.text === "string") {
      const item = chat.findLast((entry) => entry.id === pendingId && entry.role === "pi");
      if (item) item.text += message.text;
    } else if (message.type === "answer" && message.id === pendingId && typeof message.text === "string") {
      const item = chat.findLast((entry) => entry.id === pendingId && entry.role === "pi");
      if (item) item.text = message.text;
      pendingId = undefined;
      status = "ready";
      editor.disableSubmit = false;
    } else if (message.type === "concluded" && message.id === pendingId && typeof message.text === "string") {
      const item = chat.findLast((entry) => entry.id === pendingId && entry.role === "pi");
      if (item) item.text = message.text;
      if (typeof message.plan === "string") plan = message.plan;
      pendingId = undefined;
      status = "concluded · handoff ready";
      editor.disableSubmit = false;
    } else if (message.type === "suggest_conclusion" && typeof message.planKey === "string") {
      chat.push({
        id: `suggest:${message.planKey}`,
        role: "pi",
        text: "The plan appears coherent, with risks addressed and open questions explicit. You can run **Conclude debate** when ready.",
      });
      status = "ready · conclusion suggested";
    } else if (message.type === "error") {
      if (message.id === pendingId) {
        chat = chat.filter((entry) => !(entry.id === pendingId && entry.role === "pi"));
        pendingId = undefined;
      }
      status = typeof message.message === "string" ? message.message : "error";
      editor.disableSubmit = false;
    }
    render();
  }
});
socket.on("close", () => {
  if (closed) return;
  status = "Pi bridge closed · Ctrl+C";
  editor.disableSubmit = true;
  render();
});
socket.on("error", (error) => {
  status = error.message;
  render();
});

editor.onSubmit = (raw) => {
  const text = raw.trim();
  if (!text) return;
  editor.setText("");
  if (text === "/q" || text === "/quit") return finish();
  if (text === "/conclude") return requestConclusion();
  if (text.startsWith("/plan ")) {
    plan = text.slice(6).trim();
    socket.write(encodeMessage({ type: "set_plan", plan }));
    status = "plan updated";
    return render();
  }

  const id = randomUUID();
  chat.push({ id, role: "you", text });
  socket.write(encodeMessage({ type: "ask", id, text }));
  render();
};

tui.addInputListener((data) => {
  if (matchesKey(data, "ctrl+c")) {
    finish();
    return { consume: true };
  }
  if (matchesKey(data, "ctrl+d")) {
    requestConclusion();
    return { consume: true };
  }
  return undefined;
});

render();
tui.start();

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomBytes } from "node:crypto";
import { chmod, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compactText,
  encodeMessage,
  MAX_PLAN_CHARS,
  MAX_QUESTION_CHARS,
  MAX_WIRE_CHARS,
  parseReply,
  sparringPrompt,
} from "./protocol.js";

interface ActiveRequest {
  id: string;
  latestText: string;
}

interface PlanEntry {
  type: string;
  customType?: string;
  data?: { plan?: string };
}

const ROOT = dirname(fileURLToPath(import.meta.url));
const TUI_PATH = join(ROOT, "tui.js");

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export default function sokratesMode(pi: ExtensionAPI): void {
  let ctx: ExtensionContext | undefined;
  let plan = "No plan yet.";
  let server: Server | undefined;
  let socketPath = "";
  let token = "";
  let herdrTabId: string | undefined;
  let clients = new Set<Socket>();
  let authenticated = new Set<Socket>();
  let active: ActiveRequest | undefined;

  const send = (socket: Socket, message: unknown): void => {
    if (!socket.destroyed) socket.write(encodeMessage(message));
  };

  const broadcast = (message: unknown): void => {
    for (const socket of authenticated) send(socket, message);
  };

  const savePlan = (next: string): void => {
    const normalized = compactText(next, MAX_PLAN_CHARS);
    if (!normalized) return;
    plan = normalized;
    pi.appendEntry("sokrates-plan", { plan });
    broadcast({ type: "plan", plan });
  };

  const handleAsk = (socket: Socket, id: string, rawText: string): void => {
    const question = compactText(rawText, MAX_QUESTION_CHARS);
    if (!question) return send(socket, { type: "error", id, message: "Empty question" });
    if (!ctx?.isIdle() || active) {
      return send(socket, { type: "error", id, message: "Pi is busy" });
    }

    active = { id, latestText: "" };
    broadcast({ type: "thinking", id });
    try {
      pi.sendMessage(
        {
          customType: "sokrates-request",
          content: sparringPrompt(plan, question),
          display: false,
        },
        { triggerTurn: true },
      );
    } catch (error) {
      active = undefined;
      send(socket, { type: "error", id, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleLine = (socket: Socket, line: string): void => {
    if (!line || line.length > MAX_WIRE_CHARS) {
      socket.destroy();
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      socket.destroy();
      return;
    }

    if (!authenticated.has(socket)) {
      if (message.type !== "auth" || message.token !== token) {
        socket.destroy();
        return;
      }
      authenticated.add(socket);
      send(socket, { type: "hello", plan, sessionId: ctx?.sessionManager.getSessionId() });
      return;
    }

    if (message.type === "ask" && typeof message.id === "string" && typeof message.text === "string") {
      handleAsk(socket, message.id, message.text);
    } else if (message.type === "set_plan" && typeof message.plan === "string") {
      savePlan(message.plan);
    }
  };

  const startServer = async (): Promise<void> => {
    if (server) return;
    const sessionId = ctx?.sessionManager.getSessionId();
    if (!sessionId) throw new Error("No active Pi session");
    token = randomBytes(24).toString("base64url");
    socketPath = join("/tmp", `sokrates-${process.getuid?.() ?? "user"}-${sessionId.slice(0, 12)}.sock`);
    await unlink(socketPath).catch(() => undefined);

    server = createServer((socket) => {
      clients.add(socket);
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.length > MAX_WIRE_CHARS) return socket.destroy();
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          handleLine(socket, line);
        }
      });
      socket.on("close", () => {
        clients.delete(socket);
        authenticated.delete(socket);
      });
      socket.on("error", () => undefined);
    });

    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(socketPath, () => {
        server!.off("error", reject);
        resolve();
      });
    });
    await chmod(socketPath, 0o600);
  };

  const launchHerdr = async (): Promise<void> => {
    if (process.env.HERDR_ENV !== "1") throw new Error("Sokrates mode requires Pi to run inside Herdr");
    const session = process.env.HERDR_SESSION;
    const workspace = process.env.HERDR_WORKSPACE_ID;
    if (!session || !workspace) throw new Error("Herdr session/workspace identity is unavailable");

    if (herdrTabId) {
      const existing = await pi.exec("herdr", ["tab", "get", herdrTabId, "--session", session]);
      if (existing.code === 0 && existing.stdout.includes(herdrTabId)) {
        await pi.exec("herdr", ["tab", "focus", herdrTabId, "--session", session]);
        return;
      }
      herdrTabId = undefined;
    }

    const created = await pi.exec("herdr", [
      "tab", "create",
      "--workspace", workspace,
      "--cwd", ctx?.cwd ?? process.cwd(),
      "--label", "sokrates",
      "--env", `SOKRATES_SOCKET=${socketPath}`,
      "--env", `SOKRATES_TOKEN=${token}`,
      "--focus",
      "--session", session,
    ]);
    if (created.code !== 0) throw new Error(created.stderr.trim() || "Herdr could not create the tab");

    const result = JSON.parse(created.stdout) as {
      result?: { tab?: { tab_id?: string }; root_pane?: { pane_id?: string } };
    };
    const tabId = result.result?.tab?.tab_id;
    const paneId = result.result?.root_pane?.pane_id;
    if (!tabId || !paneId) throw new Error("Herdr returned no tab/pane identity");
    herdrTabId = tabId;

    const command = `exec node ${shellQuote(TUI_PATH)}`;
    const ran = await pi.exec("herdr", ["pane", "run", paneId, command, "--session", session]);
    if (ran.code !== 0) throw new Error(ran.stderr.trim() || "Herdr could not start the TUI");
  };

  const open = async (initialPlan: string): Promise<void> => {
    savePlan(initialPlan);
    await startServer();
    await launchHerdr();
  };

  pi.registerTool({
    name: "sokrates_open",
    label: "Sokrates",
    description: "Open the plan-sparring TUI for the current plan in a separate Herdr tab.",
    parameters: Type.Object({
      plan: Type.String({ description: "Compact, complete current plan in Markdown", maxLength: MAX_PLAN_CHARS }),
    }),
    async execute(_id, params) {
      await open(params.plan);
      return {
        content: [{ type: "text", text: "Opened." }],
        details: { plan },
        terminate: true,
      };
    },
  });

  pi.registerCommand("sokrates", {
    description: "Open Sokrates plan sparring",
    handler: async (args, commandCtx) => {
      ctx = commandCtx;
      const fallback = args.trim() || plan;
      try {
        await open(fallback);
      } catch (error) {
        commandCtx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.on("session_start", (_event, eventCtx) => {
    ctx = eventCtx;
    const saved = eventCtx.sessionManager.getEntries()
      .filter((entry) => entry.type === "custom" && entry.customType === "sokrates-plan")
      .at(-1) as PlanEntry | undefined;
    if (saved?.data?.plan) plan = compactText(saved.data.plan, MAX_PLAN_CHARS);
  });

  pi.on("tool_call", (event) => {
    if (!active) return;
    return { block: true, reason: "Sokrates mode is debate-only; tools are disabled for this response." };
  });

  pi.on("message_update", (event) => {
    if (!active || event.message.role !== "assistant") return;
    const update = event.assistantMessageEvent;
    if (update.type === "text_delta") broadcast({ type: "delta", id: active.id, text: update.delta });
  });

  pi.on("message_end", (event) => {
    if (!active || event.message.role !== "assistant") return;
    const message = event.message as AssistantMessage;
    active.latestText = assistantText(message);
    const parsed = parseReply(active.latestText);
    if (!parsed.plan) return;
    savePlan(parsed.plan);

    let replaced = false;
    return {
      message: {
        ...message,
        content: message.content.map((part) => {
          if (part.type !== "text") return part;
          if (replaced) return { ...part, text: "" };
          replaced = true;
          return { ...part, text: parsed.answer };
        }),
      },
    };
  });

  pi.on("agent_settled", () => {
    if (!active) return;
    const request = active;
    active = undefined;
    const parsed = parseReply(request.latestText);
    if (parsed.plan && parsed.plan !== plan) savePlan(parsed.plan);
    broadcast({ type: "answer", id: request.id, text: parsed.answer || "No answer." });
  });

  pi.on("session_shutdown", async () => {
    active = undefined;
    for (const socket of clients) socket.destroy();
    clients = new Set();
    authenticated = new Set();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    if (socketPath) await unlink(socketPath).catch(() => undefined);
  });
}

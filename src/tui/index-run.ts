#!/usr/bin/env tsx
/**
 * TUI entry point для AI-Agent.
 * Запуск: npx tsx src/tui/index-run.ts [session-id]
 * Или:    bash src/tui/run.sh [session-id]
 *
 * ВАЖНО: Для работы TUI нужен TTY. Запускайте из терминала, не из IDE.
 */
import React from "react";
import { render } from "ink";
import { TUIApp } from "./index.js";
import { SupervisorAgent } from "../agents/supervisor.js";
import { RegistryMonitor } from "../registry/monitor.js";
import { Tracer } from "../services/observability/tracer.js";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.stdin.isTTY) {
  console.error("Error: TUI requires a TTY terminal. Run directly from terminal, not from IDE.");
  process.exit(1);
}

async function main() {
  console.clear();

  const tracer = new Tracer({ minLevel: "info", enableConsole: false });
  const monitor = new RegistryMonitor({ tracer });
  const supervisor = new SupervisorAgent();

  const registry = (supervisor as unknown as { registry: Array<Record<string, unknown>> }).registry ?? [];
  for (const agent of registry) {
    monitor.registerAgent(agent as any);
  }

  const sessionId = process.argv[2];

  const app = React.createElement(TUIApp, {
    supervisor,
    monitor,
    initialSessionId: sessionId,
  });

  const { waitUntilExit } = render(app, {
    exitOnCtrlC: true,
  });

  await waitUntilExit();
}

main().catch((e) => {
  console.error("TUI Error:", e);
  process.exit(1);
});

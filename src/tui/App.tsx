import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { SupervisorAgent } from "../../agents/supervisor.js";
import { parseInput, generateHelp } from "./commands/parser.js";
import { RegistryMonitor } from "../../registry/monitor.js";
import type { AgentHealth } from "../../registry/monitor.js";
import { AgentsPanel } from "./components/AgentsPanel.js";
import { MetricsPanel } from "./components/MetricsPanel.js";
import { SessionsPanel } from "./components/SessionsPanel.js";
import { LogsPanel } from "./components/LogsPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { ProgressBar } from "./components/ProgressBar.js";
import type { ConversationSession } from "../../services/memory/types.js";
import type { ChatMessage, TabId, ProcessingState, TraceEvent } from "./types.js";

// === TABS ===
const TABS: { id: TabId; label: string }[] = [
  { id: "chat", label: "[1] Чат" },
  { id: "agents", label: "[2] Aгенты" },
  { id: "metrics", label: "[3] Метрики" },
  { id: "sessions", label: "[4] Сессии" },
  { id: "logs", label: "[5] Логи" },
];

interface TUIAppProps {
  supervisor: SupervisorAgent;
  monitor: RegistryMonitor;
  initialSessionId?: string;
}

export function TUIApp({ supervisor, monitor, initialSessionId }: TUIAppProps) {
  const { exit } = useApp();

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "system", content: "Добро пожаловать в AI-Agent TUI! Введите /help для списка команд.", timestamp: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(initialSessionId ?? "session-" + Date.now());
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [processing, setProcessing] = useState<ProcessingState>({ active: false, toolCount: 0, startTime: 0 });
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const [agentHealth, setAgentHealth] = useState<AgentHealth[]>([]);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);

  // Load panel data periodically
  const dataIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const loadData = () => {
      setAgentHealth(monitor.getAllHealth());
      setSessions(supervisor.listSessions() as ConversationSession[]);
    };
    loadData();
    dataIntervalRef.current = setInterval(loadData, 2000);
    return () => {
      if (dataIntervalRef.current) clearInterval(dataIntervalRef.current);
    };
  }, [monitor, supervisor, refreshTick]);

  // Tab navigation
  useInput((_inputChar, key) => {
    if (key.ctrl && _inputChar === "c") {
      exit();
      return;
    }
    setActiveTab((prev) => {
      if (_inputChar === "1") return "chat";
      if (_inputChar === "2") return "agents";
      if (_inputChar === "3") return "metrics";
      if (_inputChar === "4") return "sessions";
      if (_inputChar === "5") return "logs";
      return prev;
    });
  });

  // Handle command
  const handleCommand = useCallback(async (cmd: { type: string; name: string; args: string[] }) => {
    switch (cmd.name) {
      case "exit":
      case "quit":
        exit();
        return;

      case "help":
        setMessages((prev) => [...prev, {
          role: "system",
          content: generateHelp(),
          timestamp: Date.now(),
        }]);
        break;

      case "history": {
        const history = supervisor.getConversationHistory(sessionId);
        const lines = history.map((m) => "[" + m.role + "] " + m.content.slice(0, 200));
        setMessages((prev) => [...prev, {
          role: "system",
          content: "История сессии " + sessionId + ":\n" + (lines.length > 0 ? lines.join("\n") : "(пусто)"),
          timestamp: Date.now(),
        }]);
        break;
      }

      case "sessions": {
        const allSessions = supervisor.listSessions();
        const lines = allSessions.map((s) =>
          s.id === sessionId ? "  -> " + s.id + " (" + s.messages.length + " msgs)" : "     " + s.id + " (" + s.messages.length + " msgs)"
        );
        setMessages((prev) => [...prev, {
          role: "system",
          content: "Активные сессии:\n" + lines.join("\n"),
          timestamp: Date.now(),
        }]);
        break;
      }

      case "session":
        if (cmd.args.length > 0) {
          setSessionId(cmd.args.join(" "));
          setMessages((prev) => [...prev, {
            role: "system",
            content: "Переключено на сессию: " + cmd.args.join(" "),
            timestamp: Date.now(),
          }]);
        } else {
          setMessages((prev) => [...prev, {
            role: "system",
            content: "Текущая сессия: " + sessionId + "\nИспользуйте /session <id> для переключения",
            timestamp: Date.now(),
          }]);
        }
        break;

      case "new": {
        const newSid = "session-" + Date.now();
        setSessionId(newSid);
        setMessages([{
          role: "system",
          content: "Новая сессия создана: " + newSid,
          timestamp: Date.now(),
        }]);
        break;
      }

      case "clear":
        supervisor.clearSession(sessionId);
        setMessages([{
          role: "system",
          content: "История сессии " + sessionId + " очищена.",
          timestamp: Date.now(),
        }]);
        break;

      case "agents":
        setActiveTab("agents");
        break;

      case "agent":
        if (cmd.args.length > 0) {
          const h = monitor.getAgentHealth(cmd.args[0]);
          if (h) {
            setMessages((prev) => [...prev, {
              role: "system",
              content:
                "Агент: " + h.agentId + "\n" +
                "  Статус: " + h.status + "\n" +
                "  Checks: " + h.totalChecks + " | Failures: " + h.totalFailures + "\n" +
                "  Consecutive failures: " + h.consecutiveFailures + "\n" +
                "  Avg response: " + Math.round(h.avgResponseMs) + "ms\n" +
                "  Last error: " + (h.lastError ?? "нет"),
              timestamp: Date.now(),
            }]);
          } else {
            setMessages((prev) => [...prev, {
              role: "system",
              content: "Агент не найден: " + cmd.args[0],
              timestamp: Date.now(),
            }]);
          }
        }
        break;

      case "health":
        setRefreshTick((t) => t + 1);
        {
          const health = monitor.getAllHealth();
          const healthLines = health.map((h) =>
            "  " + (h.status === "active" ? "[OK]" : h.status === "degraded" ? "[WARN]" : "[FAIL]") +
            " " + h.agentId + ": " + h.status + " (" + h.totalChecks + " checks, " + h.totalFailures + " errors)"
          );
          setMessages((prev) => [...prev, {
            role: "system",
            content: "Здоровье агентов:\n" + healthLines.join("\n"),
            timestamp: Date.now(),
          }]);
        }
        break;

      case "metrics":
        setActiveTab("metrics");
        break;

      case "eval":
        setMessages((prev) => [...prev, {
          role: "system",
          content: "Запуск offline evaluation...",
          timestamp: Date.now(),
        }]);
        try {
          const { runOfflineEvaluation } = await import("../../services/evaluation/middleware.js");
          // Access evaluation service through orchestrator
          const orch = (supervisor as unknown as { orchestrator: { _evaluationService?: unknown } }).orchestrator;
          const evalService = (orch as unknown as { evaluationService?: unknown }).evaluationService;
          if (evalService) {
            const result = await runOfflineEvaluation(evalService as any);
            const failLines = result.failures.map((f) => '    "' + f.input + '": expected ' + f.expected + ", got " + f.actual);
            setMessages((prev) => [...prev, {
              role: "system",
              content:
                "Evaluation результат:\n" +
                "  Accuracy: " + (result.accuracy * 100).toFixed(1) + "%\n" +
                "  Passed: " + result.passed + "/" + result.totalTests + "\n" +
                (result.failures.length > 0 ? "\nОшибки:\n" + failLines.join("\n") : ""),
              timestamp: Date.now(),
            }]);
          } else {
            setMessages((prev) => [...prev, {
              role: "system",
              content: "EvaluationService не доступен в SupervisorAgent.",
              timestamp: Date.now(),
            }]);
          }
        } catch (e: any) {
          setMessages((prev) => [...prev, {
            role: "system",
            content: "Ошибка evaluation: " + e.message,
            timestamp: Date.now(),
          }]);
        }
        break;

      case "export": {
        const what = cmd.args[0] ?? "history";
        let content = "";
        switch (what) {
          case "metrics":
            content = supervisor.getMetrics();
            break;
          case "logs":
            content = supervisor.getLogs();
            break;
          case "audit":
            content = supervisor.getAuditLog();
            break;
          case "history":
          default:
            content = JSON.stringify(supervisor.getConversationHistory(sessionId), null, 2);
            break;
        }
        setMessages((prev) => [...prev, {
          role: "system",
          content:
            "=== Экспорт: " + what + " ===\n" +
            content.slice(0, 2000) + (content.length > 2000 ? "\n... (обрезано)" : ""),
          timestamp: Date.now(),
        }]);
        break;
      }

      case "logs": {
        setActiveTab("logs");
        break;
      }

      case "status":
        setMessages((prev) => [...prev, {
          role: "system",
          content:
            "=== Статус системы ===\n" +
            "  Сессия: " + sessionId + "\n" +
            "  Сообщений: " + messages.length + "\n" +
            "  Агентов: " + monitor.getAllHealth().length + "\n" +
            "  Сессий: " + supervisor.listSessions().length + "\n",
          timestamp: Date.now(),
        }]);
        break;

      default:
        setMessages((prev) => [...prev, {
          role: "system",
          content: "Неизвестная команда: /" + cmd.name + "\nВведите /help для списка команд.",
          timestamp: Date.now(),
        }]);
    }
  }, [sessionId, supervisor, monitor, exit, messages.length]);

  // Handle message submit
  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const parsed = parseInput(trimmed);

    const userMsg: ChatMessage = { role: "user", content: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    if (parsed.type === "command") {
      await handleCommand(parsed);
      setInput("");
      return;
    }

    setInput("");
    setProcessing({ active: true, toolCount: 0, startTime: Date.now() });

    try {
      setTraceEvents((prev) => [...prev.slice(-20), {
        type: "classification",
        timestamp: Date.now(),
        data: { intent: "detecting...", confidence: 0 },
      }]);

      const response = await supervisor.handle(parsed.content, sessionId);

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      setTraceEvents((prev) => [...prev.slice(-20), {
        type: "agent_call",
        timestamp: Date.now(),
        data: { agentId: "unknown", confidence: 1 },
      }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        role: "system",
        content: "Ошибка: " + e.message,
        timestamp: Date.now(),
      }]);
    } finally {
      setProcessing({ active: false, toolCount: 0, startTime: 0 });
      setRefreshTick((t) => t + 1);
    }
  }, [sessionId, supervisor, handleCommand]);

  // Render
  const visibleMessages = messages.slice(-50);
  const chatLines = visibleMessages.map((m) => {
    const time = new Date(m.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    if (m.role === "user") {
      return { fg: "cyan" as const, text: "[" + time + "] You: " + m.content };
    }
    if (m.role === "system") {
      return { fg: "gray" as const, text: "[" + time + "] Sys: " + m.content };
    }
    return { fg: "green" as const, text: "[" + time + "] Bot: " + m.content };
  });

  const renderPanel = () => {
    switch (activeTab) {
      case "agents":
        return React.createElement(AgentsPanel, { health: agentHealth });
      case "metrics":
        return React.createElement(MetricsPanel, { supervisor });
      case "sessions":
        return React.createElement(SessionsPanel, { sessions, currentSessionId: sessionId });
      case "logs":
        return React.createElement(LogsPanel, { supervisor, events: traceEvents });
      case "chat":
      default:
        return null;
    }
  };

  return React.createElement(Box, { flexDirection: "column", height: "100%" },
    // Header
    React.createElement(Box, { borderStyle: "double", borderColor: "blue", paddingX: 1, marginBottom: 0 },
      React.createElement(Text, { bold: true, color: "blue" }, " AI-Agent TUI "),
      React.createElement(Text, { dimColor: true }, " | Сессия: " + sessionId.slice(0, 40)),
      React.createElement(Text, { dimColor: true }, " | Агентов: " + agentHealth.length),
      processing.active ? React.createElement(Text, { color: "yellow" }, " | [...] Обработка...") : null
    ),

    // Progress bar
    processing.active ? React.createElement(ProgressBar, {
      active: processing.active,
      agentId: processing.agentId,
      toolCount: processing.toolCount,
      startTime: processing.startTime,
    }) : null,

    // Chat area
    React.createElement(Box, { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: "gray", paddingX: 1 },
      React.createElement(Text, { bold: true, underline: true }, "Чат"),
      ...chatLines.map((line, i) =>
        React.createElement(Text, { key: i, color: line.fg, wrap: "wrap" }, line.text)
      )
    ),

    // Bottom panel
    activeTab !== "chat" ? renderPanel() : null,

    // Tab bar
    React.createElement(Box, { borderStyle: "single", borderColor: "cyan", paddingX: 1 },
      ...TABS.map((tab) =>
        React.createElement(Text, {
          key: tab.id,
          color: activeTab === tab.id ? "cyan" : "gray",
          bold: activeTab === tab.id,
        }, tab.label + " ")
      )
    ),

    // Status bar
    React.createElement(StatusBar, {
      processing: processing.active,
      agentCount: agentHealth.length,
      sessionCount: sessions.length,
      messageCount: messages.length,
    }),

    // Input
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(Box, { paddingX: 1 },
        React.createElement(Text, { color: "cyan" }, "> "),
        React.createElement(TextInput, {
          value: input,
          onChange: setInput,
          onSubmit: handleSubmit,
          placeholder: "Введите сообщение или /help...",
        })
      )
    ),

    // Keyboard hint
    React.createElement(Box, { paddingX: 1 },
      React.createElement(Text, { dimColor: true }, "1-5: вкладки | Ctrl+C: выход | /exit: выход")
    )
  );
}

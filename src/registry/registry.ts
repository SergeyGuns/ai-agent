import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { z } from "zod";

// === Zod схемы для валидации ===

const SemVerSchema = z.string().regex(
  /^\d+\.\d+\.\d+$/,
  "Version must be in SemVer format (e.g., 1.0.0)",
);

const TrafficWeightSchema = z.number().min(0).max(1).optional().default(1);

const AgentYamlSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, "ID must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1),
  type: z.enum(["local", "remote"]),
  capabilities: z.array(z.string().min(1)).min(1),
  version: SemVerSchema.optional().default("1.0.0"),
  status: z.enum(["active", "inactive", "degraded"]).optional().default("active"),
  description: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  // === Versioning ===
  promptVersion: z.string().optional().default("1.0.0"),
  modelVersion: z.string().optional(),
  trafficWeight: TrafficWeightSchema,
  // === RBAC ===
  role: z.enum(["admin", "developer", "researcher", "readonly"]).optional().default("readonly"),
});

const AgentsYamlSchema = z.array(AgentYamlSchema).min(1);

export type AgentYamlDescriptor = z.infer<typeof AgentYamlSchema>;

// === Registry ===

export interface RegistryLoadResult {
  agents: AgentYamlDescriptor[];
  errors: string[];
  warnings: string[];
}

/**
 * Загрузить и валидировать Agent Registry из YAML.
 *
 * Реализует паттерн Dynamic Agent Registry (MS Reference Architecture Pattern #2):
 * - Валидация схемы при загрузке
 * - Проверка уникальности ID
 * - Проверка корректности capabilities
 * - Версионирование агентов (SemVer)
 * - Canary deployment (trafficWeight)
 */
export function loadRegistry(): AgentYamlDescriptor[] {
  const yamlPath = path.resolve(process.cwd(), "src", "registry", "agents.yaml");
  const raw = fs.readFileSync(yamlPath, "utf-8");
  const data = yaml.load(raw);

  const errors: string[] = [];
  const warnings: string[] = [];

  // Валидация схемы
  const parseResult = AgentsYamlSchema.safeParse(data);
  if (!parseResult.success) {
    const formatted = parseResult.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    errors.push(...formatted);
    throw new Error(`Registry validation failed: ${errors.join(", ")}`);
  }

  const agents = parseResult.data;

  // Проверка уникальности ID
  const seenIds = new Set<string>();
  for (const agent of agents) {
    if (seenIds.has(agent.id)) {
      errors.push(`Duplicate agent ID: ${agent.id}`);
    }
    seenIds.add(agent.id);
  }

  if (errors.length > 0) {
    throw new Error(`Registry validation failed: ${errors.join(", ")}`);
  }

  // Проверка уникальности capabilities (warning если дублируются)
  const capabilityOwners = new Map<string, string>();
  for (const agent of agents) {
    for (const cap of agent.capabilities) {
      if (capabilityOwners.has(cap) && cap !== "general") {
        warnings.push(
          `Capability "${cap}" is shared between "${capabilityOwners.get(cap)}" and "${agent.id}"`,
        );
      }
      capabilityOwners.set(cap, agent.id);
    }
  }

  // Warnings для inactive/degraded агентов
  for (const agent of agents) {
    if (agent.status === "inactive") {
      warnings.push(`Agent "${agent.id}" is registered as inactive`);
    }
    if (agent.status === "degraded") {
      warnings.push(`Agent "${agent.id}" is registered as degraded`);
    }
    if (agent.trafficWeight !== undefined && agent.trafficWeight < 1) {
      warnings.push(`Agent "${agent.id}" has canary traffic weight: ${agent.trafficWeight}`);
    }
  }

  return agents;
}

/**
 * Получить только активных агентов (с учётом trafficWeight)
 */
export function loadActiveAgents(): AgentYamlDescriptor[] {
  return loadRegistry().filter((a) => a.status === "active");
}

/**
 * Найти агента по ID
 */
export function findAgentById(id: string): AgentYamlDescriptor | undefined {
  return loadRegistry().find((a) => a.id === id);
}

/**
 * Найти агентов по capability (только активные)
 */
export function findAgentsByCapability(capability: string): AgentYamlDescriptor[] {
  return loadRegistry().filter(
    (a) => a.capabilities.includes(capability) && a.status === "active",
  );
}

/**
 * Выбрать агента с учётом canary traffic weight.
 * Для каждого capability может быть несколько версий с разным weight.
 * Эта функция выбирает одного на основе случайного числа.
 */
export function selectAgentForCapability(
  capability: string,
  randomFn: () => number = Math.random,
): AgentYamlDescriptor | undefined {
  const agents = findAgentsByCapability(capability);
  if (agents.length === 0) return undefined;
  if (agents.length === 1) return agents[0];

  // Считаем общий вес
  const totalWeight = agents.reduce((sum, a) => sum + (a.trafficWeight ?? 1), 0);
  const random = randomFn() * totalWeight;

  let cumulative = 0;
  for (const agent of agents) {
    cumulative += agent.trafficWeight ?? 1;
    if (random <= cumulative) return agent;
  }

  return agents[agents.length - 1]; // Fallback
}

/**
 * Проверить совместимость версий агента (SemVer)
 */
export function checkVersionCompatibility(
  currentVersion: string,
  targetVersion: string,
): { compatible: boolean; breaking: boolean; changes: string[] } {
  const current = parseSemVer(currentVersion);
  const target = parseSemVer(targetVersion);

  const changes: string[] = [];
  let breaking = false;

  if (target.major > current.major) {
    breaking = true;
    changes.push(`Major version bump: ${current.major} → ${target.major} (breaking changes)`);
  } else if (target.minor > current.minor) {
    changes.push(`Minor version bump: ${current.minor} → ${target.minor} (new features)`);
  } else if (target.patch > current.patch) {
    changes.push(`Patch version bump: ${current.patch} → ${target.patch} (bug fixes)`);
  }

  return {
    compatible: !breaking,
    breaking,
    changes,
  };
}

function parseSemVer(version: string): { major: number; minor: number; patch: number } {
  const parts = version.split(".").map(Number);
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
  };
}

/**
 * Экспорт реестра в указанную версию (для rollback)
 */
export function exportRegistry(
  agents: AgentYamlDescriptor[],
  outputPath: string,
): void {
  const yamlStr = yaml.dump(agents);
  fs.writeFileSync(outputPath, yamlStr, "utf-8");
}

// === Re-export rollback functions (MS Reference Architecture: Versioning) ===
export {
  createSnapshot,
  listSnapshots,
  rollbackToSnapshot,
  pruneSnapshots,
} from "./rollback.js";
export type { RegistrySnapshot, RollbackResult } from "./rollback.js";

// === Re-export monitor (MS Reference Architecture: Agent Registry — Monitor Component) ===
export { RegistryMonitor } from "./monitor.js";
export type { AgentHealth, MonitorOptions } from "./monitor.js";

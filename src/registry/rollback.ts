import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { AgentYamlDescriptor } from "./registry.js";

/**
 * RegistrySnapshotManager — управление снапшотами Agent Registry.
 *
 * Реализует Agent Versioning (MS Reference Architecture: Versioning):
 * - Создание снимка реестра перед деплоем новых версий
 * - Быстрый rollback к предыдущей версии
 * - Хранилище снапшотов в .data/registry-snapshots/
 */

export interface RegistrySnapshot {
  id: string;
  timestamp: number;
  agents: AgentYamlDescription[];
  description?: string;
}

export interface RollbackResult {
  success: boolean;
  snapshotId: string;
  agentsRestored: number;
  warnings: string[];
}

const SNAPSHOTS_DIR = ".data/registry-snapshots";
const SNAPSHOT_FILENAME = "snapshot-{id}.yaml";
const DEFAULT_YAML_PATH = "src/registry/agents.yaml";

/**
 * Создать снапшот реестра из YAML-файла.
 * Возвращает ID снапшота.
 */
export function createSnapshot(
  yamlPath: string = DEFAULT_YAML_PATH,
  description?: string,
): string {
  const resolvedPath = path.resolve(process.cwd(), yamlPath);
  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const data = yaml.load(raw);
  const timestamp = Date.now();
  const id = "snapshot-" + timestamp;

  const snapshot: RegistrySnapshot = {
    id,
    timestamp,
    agents: data as AgentYamlDescription[],
    description,
  };

  const dir = path.resolve(process.cwd(), SNAPSHOTS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const snapshotFile = path.join(dir, id + ".yaml");
  fs.writeFileSync(snapshotFile, yaml.dump(snapshot.agents), "utf-8");

  return id;
}

/**
 * Получить список всех снапшотов (отсортированные по времени, новые первыми).
 */
export function listSnapshots(yamlPath: string = DEFAULT_YAML_PATH): RegistrySnapshot[] {
  const dir = path.resolve(process.cwd(), SNAPSHOTS_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.startsWith("snapshot-") && f.endsWith(".yaml"));
  const snapshots: RegistrySnapshot[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = yaml.load(raw);
      const timestamp = extractTimestampFromFilename(file);
      snapshots.push({
        id: path.basename(file, ".yaml"),
        timestamp,
        agents: data as AgentYamlDescription[],
      });
    } catch {
      // Повреждённый файл — пропускаем
    }
  }

  return snapshots.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Восстановить реестр из снапшота (rollback).
 * Перезаписывает agents.yaml содержимым снапшота.
 */
export function rollbackToSnapshot(
  snapshotId: string,
  yamlPath: string = DEFAULT_YAML_PATH,
): RollbackResult {
  const warnings: string[] = [];
  const dir = path.resolve(process.cwd(), SNAPSHOTS_DIR);
  const snapshotFile = path.join(dir, snapshotId + ".yaml");

  if (!fs.existsSync(snapshotFile)) {
    return {
      success: false,
      snapshotId,
      agentsRestored: 0,
      warnings: [`Snapshot not found: ${snapshotId}`],
    };
  }

  try {
    const raw = fs.readFileSync(snapshotFile, "utf-8");
    const data = yaml.load(raw) as AgentYamlDescription[];

    // Перед rollback сохраняем текущее состояние как снапшот
    try {
      createSnapshot(yamlPath, "auto-backup before rollback to " + snapshotId);
    } catch {
      warnings.push("Could not create pre-rollback backup");
    }

    // Записываем снапшот как текущий registry
    const resolvedPath = path.resolve(process.cwd(), yamlPath);
    fs.writeFileSync(resolvedPath, yaml.dump(data), "utf-8");

    return {
      success: true,
      snapshotId,
      agentsRestored: data.length,
      warnings,
    };
  } catch (e: any) {
    return {
      success: false,
      snapshotId,
      agentsRestored: 0,
      warnings: [`Rollback failed: ${e.message}`],
    };
  }
}

/**
 * Удалить старые снапшоты, оставив последние N.
 */
export function pruneSnapshots(keepLast: number = 10): number {
  const snapshots = listSnapshots();
  if (snapshots.length <= keepLast) return 0;

  const toDelete = snapshots.slice(keepLast);
  const dir = path.resolve(process.cwd(), SNAPSHOTS_DIR);
  let deleted = 0;

  for (const snapshot of toDelete) {
    const filePath = path.join(dir, snapshot.id + ".yaml");
    try {
      fs.unlinkSync(filePath);
      deleted++;
    } catch {
      // Игнорируем
    }
  }

  return deleted;
}

function extractTimestampFromFilename(filename: string): number {
  // snapshot-{timestamp}.yaml
  const match = filename.match(/snapshot-(\d+)\.yaml/);
  return match ? parseInt(match[1], 10) : 0;
}

// === Type alias for backwards compatibility ===
type AgentYamlDescription = AgentYamlDescriptor;

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export interface AgentYamlDescriptor {
  id: string;
  name: string;
  type: "local" | "remote";
  capabilities: string[];
}

export function loadRegistry(): AgentYamlDescriptor[] {
  // Используем process.cwd() так как __dirname недоступен в ESM без import.meta
  const yamlPath = path.resolve(process.cwd(), "src", "registry", "agents.yaml");
  const raw = fs.readFileSync(yamlPath, "utf-8");
  return yaml.load(raw) as AgentYamlDescriptor[];
}

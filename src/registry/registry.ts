import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AgentYamlDescriptor {
  id: string;
  name: string;
  type: "local" | "remote";
  capabilities: string[];
}

export function loadRegistry(): AgentYamlDescriptor[] {
  const yamlPath = path.join(__dirname, "agents.yaml");
  const raw = fs.readFileSync(yamlPath, "utf-8");
  return yaml.load(raw) as AgentYamlDescriptor[];
}

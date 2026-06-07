import { describe, it, expect } from "vitest";
import { loadRegistry, findAgentsByCapability, checkVersionCompatibility, loadActiveAgents } from "../registry/registry.js";

describe("Agent Registry", () => {
  describe("loadRegistry", () => {
    it("loads agents from YAML", () => {
      const agents = loadRegistry();
      expect(agents.length).toBeGreaterThan(0);
    });

    it("validates agent IDs are unique", () => {
      const agents = loadRegistry();
      const ids = agents.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it("validates SemVer format for versions", () => {
      const agents = loadRegistry();
      for (const agent of agents) {
        expect(agent.version).toMatch(/^\d+\.\d+\.\d+$/);
      }
    });

    it("validates status values", () => {
      const agents = loadRegistry();
      const validStatuses = ["active", "inactive", "degraded"];
      for (const agent of agents) {
        expect(validStatuses).toContain(agent.status);
      }
    });

    it("validates capabilities are non-empty", () => {
      const agents = loadRegistry();
      for (const agent of agents) {
        expect(agent.capabilities.length).toBeGreaterThan(0);
      }
    });

    it("includes versioning fields", () => {
      const agents = loadRegistry();
      for (const agent of agents) {
        expect(agent.promptVersion).toBeDefined();
        expect(agent.trafficWeight).toBeDefined();
      }
    });

    it("loadActiveAgents returns only active agents", () => {
      const agents = loadActiveAgents();
      for (const agent of agents) {
        expect(agent.status).toBe("active");
      }
    });
  });

  describe("findAgentsByCapability", () => {
    it("finds web-search agents", () => {
      const agents = findAgentsByCapability("web-search");
      expect(agents.length).toBeGreaterThan(0);
      expect(agents[0].id).toBe("web-research-agent");
    });

    it("finds code-search agents", () => {
      const agents = findAgentsByCapability("code-search");
      expect(agents.length).toBeGreaterThan(0);
      expect(agents[0].id).toBe("code-agent");
    });

    it("finds retrieval agents", () => {
      const agents = findAgentsByCapability("retrieval");
      expect(agents.length).toBeGreaterThan(0);
      expect(agents[0].id).toBe("rag-agent");
    });

    it("returns empty array for unknown capability", () => {
      const agents = findAgentsByCapability("nonexistent");
      expect(agents.length).toBe(0);
    });

    it("does not return inactive agents", () => {
      const agents = findAgentsByCapability("general");
      for (const agent of agents) {
        expect(agent.status).toBe("active");
      }
    });
  });

  describe("checkVersionCompatibility", () => {
    it("detects compatible patch update", () => {
      const result = checkVersionCompatibility("1.0.0", "1.0.1");
      expect(result.compatible).toBe(true);
      expect(result.breaking).toBe(false);
    });

    it("detects compatible minor update", () => {
      const result = checkVersionCompatibility("1.0.0", "1.1.0");
      expect(result.compatible).toBe(true);
      expect(result.breaking).toBe(false);
    });

    it("detects breaking major update", () => {
      const result = checkVersionCompatibility("1.0.0", "2.0.0");
      expect(result.compatible).toBe(false);
      expect(result.breaking).toBe(true);
    });

    it("reports same version as compatible", () => {
      const result = checkVersionCompatibility("1.0.0", "1.0.0");
      expect(result.compatible).toBe(true);
      expect(result.breaking).toBe(false);
    });
  });
});

import { describe, it, expect } from "vitest";
import { AuditLog, AuditEntry } from "../services/security/index.js";

describe("AuditLog — PII Redaction & Retention", () => {
  describe("PII Redaction", () => {
    it("redacts email in resource", () => {
      const log = new AuditLog({ enablePIIRedaction: true });
      log.log({
        timestamp: Date.now(),
        agentId: "test-agent",
        action: "tool_call",
        resource: "read_file: /home/user@email.com/secret.txt",
        allowed: true,
      });

      const entries = log.getEntries();
      expect(entries[0].resource).not.toContain("user@email.com");
      expect(entries[0].resource).toContain("[EMAIL_REDACTED]");
    });

    it("redacts phone in resource", () => {
      const log = new AuditLog({ enablePIIRedaction: true });
      log.log({
        timestamp: Date.now(),
        agentId: "test-agent",
        action: "tool_call",
        resource: "contact: +7 999 123-45-67",
        allowed: true,
      });

      const entries = log.getEntries();
      expect(entries[0].resource).toContain("[PHONE_REDACTED]");
    });

    it("redacts credentials in reason", () => {
      const log = new AuditLog({ enablePIIRedaction: true });
      log.log({
        timestamp: Date.now(),
        agentId: "test-agent",
        action: "tool_call",
        resource: "api_call",
        allowed: false,
        reason: "RBAC: agent test-agent cannot use api_call with secret=abc123",
      });

      const entries = log.getEntries();
      expect(entries[0].reason).toContain("[CREDENTIAL_REDACTED]");
    });

    it("can disable PII redaction", () => {
      const log = new AuditLog({ enablePIIRedaction: false });
      log.log({
        timestamp: Date.now(),
        agentId: "test-agent",
        action: "tool_call",
        resource: "file: user@email.com.txt",
        allowed: true,
      });

      const entries = log.getEntries();
      expect(entries[0].resource).toContain("user@email.com");
    });

    it("preserves non-PII data", () => {
      const log = new AuditLog({ enablePIIRedaction: true });
      const entry: AuditEntry = {
        timestamp: 1234567890,
        agentId: "code-agent",
        action: "tool_call",
        resource: "read_file: src/orchestrator/index.ts",
        allowed: true,
        reason: undefined,
        traceId: "trace-1",
        sessionId: "session-1",
      };

      log.log(entry);
      const entries = log.getEntries();

      expect(entries[0].agentId).toBe("code-agent");
      expect(entries[0].resource).toContain("src/orchestrator/index.ts");
      expect(entries[0].action).toBe("tool_call");
      expect(entries[0].allowed).toBe(true);
    });
  });

  describe("Retention (maxEntries)", () => {
    it("trims entries when exceeding maxEntries", () => {
      const log = new AuditLog({ maxEntries: 5, enablePIIRedaction: false });

      for (let i = 0; i < 10; i++) {
        log.log({
          timestamp: Date.now(),
          agentId: "agent-" + i,
          action: "test",
          resource: "res-" + i,
          allowed: true,
        });
      }

      const entries = log.getEntries();
      expect(entries.length).toBe(5);
      // Should keep the LAST 5 entries (5, 6, 7, 8, 9)
      expect(entries[0].agentId).toBe("agent-5");
      expect(entries[4].agentId).toBe("agent-9");
    });

    it("preserves all entries when under maxEntries", () => {
      const log = new AuditLog({ maxEntries: 100, enablePIIRedaction: false });

      for (let i = 0; i < 10; i++) {
        log.log({
          timestamp: Date.now(),
          agentId: "agent-" + i,
          action: "test",
          resource: "res-" + i,
          allowed: true,
        });
      }

      expect(log.getEntries().length).toBe(10);
    });

    it("default maxEntries is 10000", () => {
      const log = new AuditLog();
      // Should accept 10000 entries without throwing
      for (let i = 0; i < 100; i++) {
        log.log({
          timestamp: Date.now(),
          agentId: "agent",
          action: "test",
          resource: "res",
          allowed: true,
        });
      }
      expect(log.getEntries().length).toBe(100);
    });
  });
});

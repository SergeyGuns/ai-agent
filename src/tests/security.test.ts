import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkspaceBoundary,
  RBACService,
  redactPII,
  SecurityError,
  AuditLog,
} from "../services/security/index.js";

describe("Security", () => {
  describe("WorkspaceBoundary", () => {
    const boundary = new WorkspaceBoundary("/home/user/project");

    it("allows paths within workspace", () => {
      expect(boundary.isWithinWorkspace("/home/user/project/src/index.ts")).toBe(true);
      expect(boundary.isWithinWorkspace("/home/user/project")).toBe(true);
    });

    it("denies paths outside workspace", () => {
      expect(boundary.isWithinWorkspace("/etc/passwd")).toBe(false);
      expect(boundary.isWithinWorkspace("/home/user/other/file.ts")).toBe(false);
    });

    it("denies path traversal attempts", () => {
      expect(boundary.isWithinWorkspace("/home/user/project/../../etc/passwd")).toBe(false);
    });

    it("throws SecurityError for invalid paths", () => {
      expect(() => boundary.validatePath("/etc/passwd")).toThrow(SecurityError);
      try {
        boundary.validatePath("/etc/passwd");
      } catch (e: any) {
        expect(e.code).toBe("WORKSPACE_BOUNDARY_VIOLATION");
      }
    });

    it("returns resolved path for valid paths", () => {
      const result = boundary.validatePath("/home/user/project/src/index.ts");
      expect(result).toBe("/home/user/project/src/index.ts");
    });
  });

  describe("RBACService", () => {
    let rbac: RBACService;

    beforeEach(() => {
      rbac = new RBACService();
    });

    it("defaults to readonly role", () => {
      expect(rbac.getAgentRole("unknown-agent")).toBe("readonly");
    });

    it("sets and gets agent roles", () => {
      rbac.setAgentRole("agent-1", "admin");
      expect(rbac.getAgentRole("agent-1")).toBe("admin");
    });

    it("admin can use all tools", () => {
      rbac.setAgentRole("admin-agent", "admin");
      expect(rbac.canUseTool("admin-agent", "run_command")).toBe(true);
      expect(rbac.canUseTool("admin-agent", "write_file")).toBe(true);
      expect(rbac.canUseTool("admin-agent", "read_file")).toBe(true);
    });

    it("developer cannot run commands", () => {
      rbac.setAgentRole("dev-agent", "developer");
      expect(rbac.canUseTool("dev-agent", "run_command")).toBe(false);
      expect(rbac.canUseTool("dev-agent", "write_file")).toBe(true);
      expect(rbac.canUseTool("dev-agent", "read_file")).toBe(true);
    });

    it("readonly can only read", () => {
      rbac.setAgentRole("ro-agent", "readonly");
      expect(rbac.canUseTool("ro-agent", "read_file")).toBe(true);
      expect(rbac.canUseTool("ro-agent", "list_files")).toBe(true);
      expect(rbac.canUseTool("ro-agent", "write_file")).toBe(false);
      expect(rbac.canUseTool("ro-agent", "run_command")).toBe(false);
    });

    it("throws SecurityError for unauthorized tool access", () => {
      rbac.setAgentRole("ro-agent", "readonly");
      expect(() => rbac.validateToolAccess("ro-agent", "write_file")).toThrow(SecurityError);
      try {
        rbac.validateToolAccess("ro-agent", "write_file");
      } catch (e: any) {
        expect(e.code).toBe("RBAC_VIOLATION");
      }
    });

    it("returns allowed tools for role", () => {
      rbac.setAgentRole("dev-agent", "developer");
      const allowed = rbac.getAllowedTools("dev-agent");
      expect(allowed).toContain("read_file");
      expect(allowed).toContain("write_file");
      expect(allowed).not.toContain("run_command");
    });

    it("denies unknown tools", () => {
      rbac.setAgentRole("admin-agent", "admin");
      expect(rbac.canUseTool("admin-agent", "unknown_tool")).toBe(false);
    });
  });

  describe("PII Redaction", () => {
    it("redacts email addresses", () => {
      expect(redactPII("Contact user@example.com for info")).toBe(
        "Contact [EMAIL_REDACTED] for info",
      );
    });

    it("redacts phone numbers", () => {
      expect(redactPII("Call +7 999 123 45 67 now")).toBe(
        "Call [PHONE_REDACTED] now",
      );
    });

    it("redacts API keys", () => {
      expect(redactPII("api_key=abc123secret")).toBe("[CREDENTIAL_REDACTED]");
      expect(redactPII("token: xyz789")).toBe("[CREDENTIAL_REDACTED]");
    });

    it("redacts credit cards", () => {
      expect(redactPII("Card: 1234 5678 9012 3456")).toBe(
        "Card: [CARD_REDACTED]",
      );
    });

    it("does not redact normal text", () => {
      expect(redactPII("Hello world")).toBe("Hello world");
    });
  });

  describe("AuditLog", () => {
    it("logs entries", () => {
      const log = new AuditLog();
      log.log({
        timestamp: Date.now(),
        agentId: "agent-1",
        action: "read_file",
        resource: "/path/to/file",
        allowed: true,
      });

      expect(log.getEntries().length).toBe(1);
    });

    it("filters by agent", () => {
      const log = new AuditLog();
      log.log({ timestamp: 1, agentId: "a1", action: "read", resource: "f1", allowed: true });
      log.log({ timestamp: 2, agentId: "a2", action: "write", resource: "f2", allowed: false });
      log.log({ timestamp: 3, agentId: "a1", action: "exec", resource: "cmd", allowed: true });

      expect(log.getEntriesByAgent("a1").length).toBe(2);
    });

    it("filters denied entries", () => {
      const log = new AuditLog();
      log.log({ timestamp: 1, agentId: "a1", action: "read", resource: "f1", allowed: true });
      log.log({ timestamp: 2, agentId: "a2", action: "write", resource: "f2", allowed: false });

      expect(log.getDeniedEntries().length).toBe(1);
    });

    it("exports to JSON", () => {
      const log = new AuditLog();
      log.log({ timestamp: 1, agentId: "a1", action: "read", resource: "f1", allowed: true });

      const json = log.export();
      const parsed = JSON.parse(json);
      expect(parsed.length).toBe(1);
    });
  });
});

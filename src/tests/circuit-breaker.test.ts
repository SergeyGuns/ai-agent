import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker, CircuitBreakerRegistry } from "../services/security/circuit-breaker.js";

describe("CircuitBreaker", () => {
  describe("initial state", () => {
    it("starts in closed state", () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe("closed");
      expect(cb.allowRequest()).toBe(true);
    });

    it("has zero stats initially", () => {
      const cb = new CircuitBreaker();
      const stats = cb.getStats();
      expect(stats.state).toBe("closed");
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(stats.totalSuccesses).toBe(0);
      expect(stats.lastFailureTime).toBeNull();
      expect(stats.lastSuccessTime).toBeNull();
      expect(stats.openedAt).toBeNull();
    });
  });

  describe("CLOSED → OPEN transition", () => {
    it("trips to open after failureThreshold consecutive failures", () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, minRequestsBeforeTrip: 1 });

      cb.recordFailure();
      expect(cb.getState()).toBe("closed");

      cb.recordFailure();
      expect(cb.getState()).toBe("closed");

      cb.recordFailure();
      expect(cb.getState()).toBe("open");
      expect(cb.allowRequest()).toBe(false);
    });

    it("does not trip before minRequestsBeforeTrip", () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, minRequestsBeforeTrip: 3 });

      cb.recordFailure();
      expect(cb.getState()).toBe("closed");

      cb.recordFailure();
      expect(cb.getState()).toBe("closed");

      // 3rd failure with minRequestsBeforeTrip=3 → now it can trip
      cb.recordFailure();
      expect(cb.getState()).toBe("open");
    });

    it("resets consecutive failures on success", () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, minRequestsBeforeTrip: 1 });

      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess(); // reset
      cb.recordFailure();
      cb.recordFailure();

      // Only 2 consecutive failures, not 4
      expect(cb.getState()).toBe("closed");
    });
  });

  describe("OPEN → HALF_OPEN transition", () => {
    it("transitions to half-open after recoveryTimeoutMs", () => {
      vi.useFakeTimers();
      const startTime = Date.now();
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        minRequestsBeforeTrip: 1,
        recoveryTimeoutMs: 5000,
      });

      cb.recordFailure();
      expect(cb.getState()).toBe("open");
      expect(cb.allowRequest()).toBe(false);

      // Before timeout — still open
      vi.setSystemTime(startTime + 4999);
      expect(cb.allowRequest()).toBe(false);

      // After timeout → half-open, allows one probe request
      vi.setSystemTime(startTime + 5000);
      expect(cb.allowRequest()).toBe(true);
      // State is half-open until the probe request result is recorded
      expect(cb.getState()).toBe("half-open");

      // After probe success → closed
      cb.recordSuccess();
      expect(cb.getState()).toBe("closed");

      vi.useRealTimers();
    });
  });

  describe("HALF_OPEN → CLOSED transition", () => {
    it("closes on successful probe request in half-open", () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        minRequestsBeforeTrip: 1,
        recoveryTimeoutMs: 100,
      });

      cb.recordFailure(); // → open, openedAt = Date.now()
      // Advance system time past recovery timeout
      vi.setSystemTime(Date.now() + 200);
      // Now allowRequest should transition to half-open
      expect(cb.allowRequest()).toBe(true);
      expect(cb.getState()).toBe("half-open");

      // Probe request succeeds → closed
      cb.recordSuccess();
      expect(cb.getState()).toBe("closed");
      expect(cb.allowRequest()).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("HALF_OPEN → OPEN transition", () => {
    it("re-opens on failed probe request in half-open", () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        minRequestsBeforeTrip: 1,
        recoveryTimeoutMs: 100,
      });

      cb.recordFailure(); // → open
      // Advance system time past recovery timeout
      vi.setSystemTime(Date.now() + 200);
      // Now allowRequest transitions to half-open
      expect(cb.allowRequest()).toBe(true);
      expect(cb.getState()).toBe("half-open");

      // Probe request fails → back to open
      cb.recordFailure();
      expect(cb.getState()).toBe("open");
      // allowRequest returns false because we just set openedAt to current time
      expect(cb.allowRequest()).toBe(false);

      vi.useRealTimers();
    });
  });

  describe("manual trip / reset", () => {
    it("trip() forces open state", () => {
      const cb = new CircuitBreaker();
      cb.trip();
      expect(cb.getState()).toBe("open");
      expect(cb.allowRequest()).toBe(false);
    });

    it("reset() forces closed state and clears stats", () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, minRequestsBeforeTrip: 1 });
      cb.recordFailure();
      expect(cb.getState()).toBe("open");

      cb.reset();
      expect(cb.getState()).toBe("closed");
      expect(cb.allowRequest()).toBe(true);
      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe("stats tracking", () => {
    it("tracks all counters correctly", () => {
      const cb = new CircuitBreaker({ failureThreshold: 5, minRequestsBeforeTrip: 1 });

      cb.recordSuccess();
      cb.recordSuccess();
      cb.recordFailure();

      const stats = cb.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(1);
      expect(stats.consecutiveFailures).toBe(1);
      expect(stats.lastSuccessTime).not.toBeNull();
      expect(stats.lastFailureTime).not.toBeNull();
    });
  });
});

describe("CircuitBreakerRegistry", () => {
  it("creates breakers lazily and trips after threshold", () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 2, minRequestsBeforeTrip: 1 });
    expect(registry.getState("agent-1")).toBe("closed");

    registry.recordFailure("agent-1");
    expect(registry.getState("agent-1")).toBe("closed");

    registry.recordFailure("agent-1");
    expect(registry.getState("agent-1")).toBe("open");
  });

  it("keeps breakers isolated per agent", () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1, minRequestsBeforeTrip: 1 });

    registry.recordFailure("agent-1");
    registry.recordSuccess("agent-2");

    expect(registry.getState("agent-1")).toBe("open");
    expect(registry.getState("agent-2")).toBe("closed");
  });

  it("remove() deletes breaker", () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1, minRequestsBeforeTrip: 1 });
    registry.recordFailure("agent-1");
    expect(registry.getState("agent-1")).toBe("open");

    registry.remove("agent-1");
    expect(registry.getState("agent-1")).toBe("closed"); // new breaker
  });

  it("resetAll() resets all breakers", () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1, minRequestsBeforeTrip: 1 });
    registry.recordFailure("agent-1");
    registry.recordFailure("agent-2");

    expect(registry.getState("agent-1")).toBe("open");
    expect(registry.getState("agent-2")).toBe("open");

    registry.resetAll();
    expect(registry.getState("agent-1")).toBe("closed");
    expect(registry.getState("agent-2")).toBe("closed");
  });

  it("getAllStats() returns all breakers stats", () => {
    const registry = new CircuitBreakerRegistry();
    registry.recordSuccess("agent-1");
    registry.recordFailure("agent-2");

    const all = registry.getAllStats();
    expect(Object.keys(all).length).toBe(2);
    expect(all["agent-1"].totalSuccesses).toBe(1);
    expect(all["agent-2"].totalFailures).toBe(1);
  });

  it("allowRequest() returns correct value", () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1, minRequestsBeforeTrip: 1 });
    expect(registry.allowRequest("agent-1")).toBe(true);

    registry.recordFailure("agent-1");
    expect(registry.allowRequest("agent-1")).toBe(false);
  });
});

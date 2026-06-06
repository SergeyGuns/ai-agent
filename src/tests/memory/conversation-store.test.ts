import { describe, it, expect, beforeEach } from "vitest";
import { ConversationStore } from "../../services/memory/conversation-store.js";

describe("ConversationStore", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore({ maxMessages: 10, maxSessions: 3 });
  });

  it("should create a new session on first message", () => {
    store.addMessage("s1", "user", "Hello");
    const messages = store.getMessages("s1");
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
  });

  it("should append messages to existing session", () => {
    store.addMessage("s1", "user", "Hello");
    store.addMessage("s1", "assistant", "Hi there");
    const messages = store.getMessages("s1");
    expect(messages.length).toBe(2);
    expect(messages[1].role).toBe("assistant");
  });

  it("should return empty array for unknown session", () => {
    const messages = store.getMessages("nonexistent");
    expect(messages.length).toBe(0);
  });

  it("should get recent messages", () => {
    for (let i = 0; i < 5; i++) {
      store.addMessage("s1", "user", "msg-" + i);
    }
    const recent = store.getRecentMessages("s1", 3);
    expect(recent.length).toBe(3);
    expect(recent[0].content).toBe("msg-2");
    expect(recent[2].content).toBe("msg-4");
  });

  it("should trim old messages when exceeding maxMessages", () => {
    for (let i = 0; i < 15; i++) {
      store.addMessage("s1", "user", "msg-" + i);
    }
    const messages = store.getMessages("s1");
    expect(messages.length).toBe(10);
    expect(messages[0].content).toBe("msg-5");
  });

  it("should evict oldest session when exceeding maxSessions", () => {
    store.addMessage("s1", "user", "first");
    store.addMessage("s2", "user", "second");
    store.addMessage("s3", "user", "third");
    store.addMessage("s4", "user", "fourth"); // should evict s1

    expect(store.sessionCount).toBe(3);
    expect(store.getMessages("s1").length).toBe(0); // evicted
    expect(store.getMessages("s4").length).toBe(1);
  });

  it("should clear session", () => {
    store.addMessage("s1", "user", "Hello");
    store.clearSession("s1");
    expect(store.getMessages("s1").length).toBe(0);
  });

  it("should list all sessions", () => {
    store.addMessage("s1", "user", "a");
    store.addMessage("s2", "user", "b");
    const sessions = store.listSessions();
    expect(sessions.length).toBe(2);
  });

  it("should include metadata in messages", () => {
    store.addMessage("s1", "assistant", "Answer", { agentId: "test-agent" });
    const messages = store.getMessages("s1");
    expect(messages[0].agentId).toBe("test-agent");
  });

  it("should export to JSON", () => {
    store.addMessage("s1", "user", "Hello");
    const json = store.exportAll();
    const parsed = JSON.parse(json);
    expect(parsed.s1).toBeDefined();
    expect(parsed.s1.messages.length).toBe(1);
  });
});

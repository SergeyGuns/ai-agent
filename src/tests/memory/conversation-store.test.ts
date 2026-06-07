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
    // Используем уникальные ID чтобы не конфликтовать с другими тестами
    store.addMessage("list-s1", "user", "a");
    store.addMessage("list-s2", "user", "b");
    const sessions = store.listSessions().filter((s) => s.id.startsWith("list-"));
    expect(sessions.length).toBe(2);
  });

  it("should include metadata in messages", () => {
    store.addMessage("s1", "assistant", "Answer", { agentId: "test-agent" });
    const messages = store.getMessages("s1");
    expect(messages[0].agentId).toBe("test-agent");
  });

  // === Session Metadata Tests ===

  it("should set and get session metadata", () => {
    store.getOrCreate("s1", { channel: "web", userId: "user-1" });
    store.setSessionMetadata("s1", { tags: ["test", "debug"] });

    const metadata = store.getSessionMetadata("s1");
    expect(metadata?.channel).toBe("web");
    expect(metadata?.userId).toBe("user-1");
    expect(metadata?.tags).toEqual(["test", "debug"]);
  });

  it("should find sessions by tag", () => {
    store.getOrCreate("s1", { tags: ["important"] });
    store.getOrCreate("s2", { tags: ["important", "urgent"] });
    store.getOrCreate("s3", { tags: ["normal"] });

    const important = store.findSessionsByTag("important");
    expect(important.length).toBe(2);
  });

  it("should find sessions by userId", () => {
    store.getOrCreate("s1", { userId: "user-1" });
    store.getOrCreate("s2", { userId: "user-2" });
    store.getOrCreate("s3", { userId: "user-1" });

    const user1Sessions = store.findSessionsByUser("user-1");
    expect(user1Sessions.length).toBe(2);
  });

  // === Retention Policy Tests ===

  it("should apply retention policy and remove old sessions", () => {
    const store = new ConversationStore({ retentionDays: 1 }); // 1 day retention
    store.addMessage("old-session", "user", "Hello");

    // Manually set updatedAt to past (2 days ago)
    const session = store.getOrCreate("old-session");
    session.updatedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;

    const removed = store.applyRetentionPolicy();
    expect(removed).toBe(1);
    expect(store.getMessages("old-session").length).toBe(0);
  });

  it("should keep recent sessions during retention", () => {
    const store = new ConversationStore({ retentionDays: 30 });
    store.addMessage("recent", "user", "Hello");

    const removed = store.applyRetentionPolicy();
    expect(removed).toBe(0);
    expect(store.getMessages("recent").length).toBe(1);
  });
});

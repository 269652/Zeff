import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_ALLOWED_TOOLS, CHAT_SOURCE, chatProfileFor, chatSource, isChatTodo, registerChatProfile } from "@/lib/chat";

test("a chat is told by its todo's source: Zeff-Chat, or Zeff-Chat:<kind> of a plugin", () => {
  assert.equal(isChatTodo({ source: CHAT_SOURCE }), true);
  assert.equal(isChatTodo({ source: chatSource("learn") }), true);
  assert.equal(chatSource("learn"), "Zeff-Chat:learn");
  assert.equal(isChatTodo({ source: "Mail" }), false);
  assert.equal(isChatTodo({ source: "Zeff-Chatter" }), false);
  assert.equal(isChatTodo(null), false);
});

test("the plain chat's profile: Zeff's tools, its rules", () => {
  const p = chatProfileFor({ id: 1, source: CHAT_SOURCE, text: "x" }, "");
  assert.ok(p.allowedTools.includes("mcp__zeff__add_todo"));
  assert.ok(p.disallowedTools.includes("Bash"));
  assert.match(p.rules, /Zeff/);
});

test("a plugin's profile for its kind of chat: its rules and tools; an unknown kind gets the plain chat's", () => {
  registerChatProfile("quiz", (todo, preamble) => ({ rules: `QUIZ RULES for ${todo.id} ${preamble}`, allowedTools: [...CHAT_ALLOWED_TOOLS, "mcp__zeff__quiz_tool"], disallowedTools: ["Bash"] }));
  const p = chatProfileFor({ id: 7, source: chatSource("quiz"), text: "x" }, "PRE");
  assert.equal(p.rules, "QUIZ RULES for 7 PRE");
  assert.ok(p.allowedTools.includes("mcp__zeff__quiz_tool"));
  const fallback = chatProfileFor({ id: 8, source: chatSource("nobody"), text: "x" }, "");
  assert.deepEqual(fallback.allowedTools, CHAT_ALLOWED_TOOLS);
});

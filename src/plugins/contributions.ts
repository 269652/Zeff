/**
 * Where the built-in plugins' contributions to each other's extension points are registered: one line
 * per plugin that brings something. A plugin's own `contribute.ts` holds what it brings (and nothing
 * else imports it), so adding a plugin is its folder plus one line here; removing one is the reverse.
 * Server only; importing this file registers them all, once.
 */
import "./jira-lage/contribute";

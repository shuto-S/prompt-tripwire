#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const packageJsonPath = resolve("package.json");
const pluginRoot = resolve("plugins/prompt-tripwire");
const manifestPath = resolve(pluginRoot, ".codex-plugin/plugin.json");
const marketplacePath = resolve(".agents/plugins/marketplace.json");
const skillPath = resolve(pluginRoot, "skills/preflight/SKILL.md");
const skillMetadataPath = resolve(pluginRoot, "skills/preflight/agents/openai.yaml");
const scriptPath = resolve(pluginRoot, "skills/preflight/scripts/run_preflight.mjs");
const installTemplatePath = resolve("scripts/distribution/install.sh");
const uninstallTemplatePath = resolve("scripts/distribution/uninstall.sh");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
const skill = readFileSync(skillPath, "utf8");
const skillMetadata = readFileSync(skillMetadataPath, "utf8");
const script = readFileSync(scriptPath, "utf8");
const installTemplate = readFileSync(installTemplatePath, "utf8");
const uninstallTemplate = readFileSync(uninstallTemplatePath, "utf8");

assert.equal(manifest.name, "prompt-tripwire");
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:[-+].*)?$/u);
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.interface.displayName, "PromptTripwire");
assert.equal(manifest.interface.category, "Developer Tools");
assert.deepEqual(manifest.interface.defaultPrompt, [
  "Use $prompt-tripwire:preflight before implementing this task.",
]);
assert.ok(!("hooks" in manifest), "v1 must not add automatic hooks");
assert.ok(!("mcpServers" in manifest), "v1 does not need an MCP server");

assert.equal(marketplace.name, "prompt-tripwire-local");
const entry = marketplace.plugins.find((plugin) => plugin.name === "prompt-tripwire");
assert.ok(entry, "repo marketplace must expose prompt-tripwire");
assert.deepEqual(entry.source, { source: "local", path: "./plugins/prompt-tripwire" });
assert.equal(entry.policy.installation, "AVAILABLE");
assert.equal(entry.policy.authentication, "ON_INSTALL");
assert.equal(entry.category, "Developer Tools");

assert.ok(skill.startsWith("---\n"), "Skill must have YAML frontmatter");
const frontmatterEnd = skill.indexOf("\n---", 4);
assert.ok(frontmatterEnd > 0, "Skill frontmatter must close");
const frontmatter = skill.slice(4, frontmatterEnd);
assert.match(frontmatter, /^name:\s*preflight\s*$/mu);
assert.match(frontmatter, /^description:\s*.+$/mu);
assert.match(skill, /explicitly asks/iu);
assert.match(skill, /Decision Inbox:/u);
assert.match(skill, /`needs_review`, `ready_for_approval`, or `paused`/u);
assert.match(skill, /Do not call `tripwire approve`/u);
assert.match(skill, /review-url/u);
assert.match(skill, /normal Codex command permission/iu);
assert.match(skill, /not a PromptTripwire decision or\s+contract approval/iu);
assert.match(skill, /retry the\s+same adapter inspect command at most once/iu);
assert.match(skill, /If the user denies permission or the\s+single retry fails, stop/iu);
assert.match(skill, /do not use a global\s+sandbox-bypass flag/iu);
assert.match(skill, /remove `PROMPT_TRIPWIRE_PLUGIN_REENTRY`/u);
assert.match(skill, /runner's stdin channel/iu);
assert.match(skill, /interactive PTY\s+\(`tty: true`\)/iu);
assert.match(skill, /stty -echo && exec node/u);
assert.match(skill, /Ctrl-D \(`\\u0004`\) twice/iu);
assert.match(skill, /Never interpolate task text into shell source/iu);
assert.doesNotMatch(
  skill,
  /\b(?:printf|echo)\b[^\r\n]{0,200}(?:exact current task|task text)/iu,
  "Skill must not interpolate untrusted task text into shell source",
);
assert.match(skillMetadata, /^interface:\s*$/mu);
assert.match(skillMetadata, /^\s+display_name:\s*"PromptTripwire Preflight"\s*$/mu);
assert.match(skillMetadata, /^policy:\s*$/mu);
assert.match(skillMetadata, /^\s+allow_implicit_invocation:\s*false\s*$/mu);
assert.doesNotMatch(skillMetadata, /allow_implicit_invocation:\s*true/iu);

assert.ok(statSync(scriptPath).isFile());
assert.match(script, /PROMPT_TRIPWIRE_PLUGIN_REENTRY/u);
assert.match(script, /REENTRY_BLOCKED/u);
assert.match(script, /CODEX_LOGIN_REQUIRED/u);
assert.match(script, /runtime\.json/u);
assert.match(script, /caller shell sandbox may have blocked/iu);
assert.match(script, /not a PromptTripwire decision.*contract approval/isu);
assert.match(script, /retry the same inspect once/iu);
assert.match(script, new RegExp(`REQUIRED_TRIPWIRE_VERSION = "${packageJson.version}"`, "u"));
assert.doesNotMatch(script, /REQUIRED_CODEX_VERSION|CODEX_VERSION_MISMATCH/u);
assert.match(installTemplate, /--with-codex-plugin/u);
assert.match(installTemplate, /plugin marketplace add/u);
assert.match(installTemplate, /plugin add "\$PLUGIN_SELECTOR"/u);
assert.match(installTemplate, /plugin list --json/u);
assert.doesNotMatch(installTemplate, /CODEX_VERSION_MISMATCH|0\.144\.4/u);
assert.doesNotMatch(installTemplate, /\b(?:inspect|approve|run)\b/u);
assert.match(uninstallTemplate, /plugin remove "\$PLUGIN_SELECTOR"/u);
assert.match(uninstallTemplate, /marketplace remove "\$MARKETPLACE_NAME"/u);
assert.doesNotMatch(uninstallTemplate, /CODEX_VERSION_MISMATCH|0\.144\.4/u);
assert.match(uninstallTemplate, /CODEX_REGISTRATION_UNVERIFIED/u);
for (const file of [
  manifestPath,
  marketplacePath,
  skillPath,
  skillMetadataPath,
  scriptPath,
  installTemplatePath,
  uninstallTemplatePath,
]) {
  const content = readFileSync(file, "utf8");
  assert.ok(!content.includes(root), `${file} must not contain a local absolute path`);
  assert.ok(
    !/sk-[A-Za-z0-9_-]{20,}/u.test(content),
    `${file} must not contain a secret-like value`,
  );
}

process.stdout.write("Plugin manifest, marketplace, Skill, and security shape passed\n");

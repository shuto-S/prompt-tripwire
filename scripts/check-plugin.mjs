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
const scriptPath = resolve(pluginRoot, "skills/preflight/scripts/run_preflight.mjs");
const installTemplatePath = resolve("scripts/distribution/install.sh");
const uninstallTemplatePath = resolve("scripts/distribution/uninstall.sh");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
const skill = readFileSync(skillPath, "utf8");
const script = readFileSync(scriptPath, "utf8");
const installTemplate = readFileSync(installTemplatePath, "utf8");
const uninstallTemplate = readFileSync(uninstallTemplatePath, "utf8");

assert.equal(manifest.name, "prompt-tripwire");
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:[-+].*)?$/u);
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.interface.displayName, "PromptTripwire");
assert.equal(manifest.interface.category, "Developer Tools");
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
assert.match(skill, /Do not call `tripwire approve`/u);
assert.match(skill, /review-url/u);

assert.ok(statSync(scriptPath).isFile());
assert.match(script, /PROMPT_TRIPWIRE_PLUGIN_REENTRY/u);
assert.match(script, /REENTRY_BLOCKED/u);
assert.match(script, /CODEX_LOGIN_REQUIRED/u);
assert.match(script, /runtime\.json/u);
assert.match(script, new RegExp(`REQUIRED_TRIPWIRE_VERSION = "${packageJson.version}"`, "u"));
assert.match(installTemplate, /--with-codex-plugin/u);
assert.match(installTemplate, /plugin marketplace add/u);
assert.match(installTemplate, /plugin add "\$PLUGIN_SELECTOR"/u);
assert.match(installTemplate, /plugin list --json/u);
assert.doesNotMatch(installTemplate, /\b(?:inspect|approve|run)\b/u);
assert.match(uninstallTemplate, /plugin remove "\$PLUGIN_SELECTOR"/u);
assert.match(uninstallTemplate, /marketplace remove "\$MARKETPLACE_NAME"/u);
for (const file of [
  manifestPath,
  marketplacePath,
  skillPath,
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

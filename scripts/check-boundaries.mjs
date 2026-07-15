#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const PURE_PACKAGE_ROOTS = [resolve("packages/domain/src"), resolve("packages/policy/src")];
const FORBIDDEN_MODULES = [
  "fs",
  "http",
  "https",
  "net",
  "tls",
  "dns",
  "dgram",
  "child_process",
  "worker_threads",
  "undici",
];
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/gu;

function sourceFiles(root) {
  if (!existsSync(root)) return [];
  const result = [];
  for (const entry of readdirSync(root).sort()) {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) result.push(...sourceFiles(path));
    else if (entry.endsWith(".ts")) result.push(path);
  }
  return result;
}

function isForbidden(specifier) {
  const normalized = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  if (
    FORBIDDEN_MODULES.some((module) => normalized === module || normalized.startsWith(`${module}/`))
  ) {
    return true;
  }
  if (specifier === "@prompt-tripwire/ui" || specifier.startsWith("@prompt-tripwire/ui/")) {
    return true;
  }
  return specifier.split(/[\\/]/u).join(sep).includes(`${sep}apps${sep}ui`);
}

export function findBoundaryViolations(roots = PURE_PACKAGE_ROOTS) {
  const violations = [];
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1];
        if (specifier && isForbidden(specifier)) {
          violations.push({ file: relative(process.cwd(), file), specifier });
        }
      }
    }
  }
  return violations;
}

function main() {
  const violations = findBoundaryViolations();
  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(
        `${violation.file}: forbidden pure-package import ${violation.specifier}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write("domain/policy import boundaries: passed\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

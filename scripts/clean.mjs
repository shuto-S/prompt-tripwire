#!/usr/bin/env node

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

for (const workspaceRoot of ["apps", "packages"]) {
  if (!existsSync(workspaceRoot)) continue;
  for (const workspace of readdirSync(workspaceRoot)) {
    rmSync(join(workspaceRoot, workspace, "dist"), { recursive: true, force: true });
  }
}
rmSync("coverage", { recursive: true, force: true });
process.stdout.write("generated build and coverage output removed\n");

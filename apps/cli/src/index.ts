#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const CLI_FOUNDATION = Object.freeze({
  name: "cli",
  version: "0.1.0-foundation",
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--version")) {
    process.stdout.write(`prompt-tripwire ${CLI_FOUNDATION.version}\n`);
  } else {
    process.stdout.write("PromptTripwire CLI foundation is ready.\n");
  }
}

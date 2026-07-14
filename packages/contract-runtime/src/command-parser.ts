import type { CommandAction } from "@prompt-tripwire/policy";

export type CommandParseResult =
  | { readonly ok: true; readonly action: CommandAction; readonly argv: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export function parseContractCommand(value: string): CommandParseResult {
  if (value.trim().length === 0 || value.length > 8_192 || /[\u0000-\u001f\u007f`$]/u.test(value)) {
    return { ok: false, reason: "invalid_command_text" };
  }

  const argv: string[] = [];
  let token = "";
  let quote: "single" | "double" | null = null;
  let escaped = false;
  let started = false;

  function finish(): void {
    if (!started) return;
    argv.push(token);
    token = "";
    started = false;
  }

  for (const character of value) {
    if (escaped) {
      token += character;
      started = true;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "single") {
      escaped = true;
      started = true;
      continue;
    }
    if (character === "'" && quote !== "double") {
      quote = quote === "single" ? null : "single";
      started = true;
      continue;
    }
    if (character === '"' && quote !== "single") {
      quote = quote === "double" ? null : "double";
      started = true;
      continue;
    }
    if (quote === null && /\s/u.test(character)) {
      finish();
      continue;
    }
    if (quote === null && /[|&;<>]/u.test(character)) {
      return { ok: false, reason: "shell_control_denied" };
    }
    token += character;
    started = true;
  }
  if (escaped || quote !== null) return { ok: false, reason: "unterminated_command_token" };
  finish();
  const program = argv[0];
  if (program === undefined || program.length === 0) {
    return { ok: false, reason: "empty_command" };
  }
  return {
    ok: true,
    action: { program, args: argv.slice(1) },
    argv,
  };
}

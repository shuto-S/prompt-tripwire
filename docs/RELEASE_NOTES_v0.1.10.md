# PromptTripwire v0.1.10

v0.1.10 makes the Japanese Decision Inbox understandable at the point of human
choice without changing what is approved. It preserves the v0.1.9 CLI,
Controller, Plugin, deterministic policy, contract, containment, execution, and
report boundaries.

## Japanese reference presentation

- A fresh ephemeral, tool-free, read-only, network-denied App Server turn uses
  the existing logged-in Codex CLI to create Japanese reference text for the
  task and final decision questions, reasons, option labels, descriptions, and
  effects.
- The Japanese UI labels translated text as a reference and provides expandable
  access to the unchanged authoritative task and full decision text.
- English presentation continues to show authoritative source text.
- Translation needs no `OPENAI_API_KEY`, hosted backend, MCP server, automatic
  hook, or new credential path.

## Authority and failure boundaries

- Reference text is stored separately in `review_presentations`; it is never an
  input to deterministic policy, decision identity, mutation fingerprints,
  contract creation or hashing, execution, or reports.
- Output must retain exact decision and option IDs and the original decision,
  option, and effect counts. Secret-like, invalid, or unbound output is rejected.
- Translation uses the same deny-all structured-turn tool boundary as the
  comparator. Any tool, permission, file-change, or diff request fails the turn.
- A translation failure does not approve or resolve anything. The UI displays a
  warning and the escaped authoritative source remains available.
- The aggregate API omits translation model/session metadata and internal
  failure detail.

## Verification

The source suite covers structured-output binding, prompt-injection treatment,
tool/late-request denial, secret-like output rejection, persistence and fallback,
contract/content-hash identity, loopback API separation, browser language
switching, Japanese task/decision rendering, authoritative source disclosure,
and the existing keyboard approval flow.

Run:

```sh
npm run check
npm run package:macos-arm64
npm run verify:release
```

The supported environment remains macOS arm64, Node.js 24.15+, npm 11+, Git,
and an authenticated Codex CLI 0.144.4. The runtime and Plugin still require no
separate OpenAI API key.

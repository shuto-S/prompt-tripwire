# OpenAI Build Week requirements matrix

Checked: 2026-07-15 JST

Authoritative sources:

- [OpenAI Build Week Official Rules](https://openai.devpost.com/rules)
- [OpenAI Build Week Resources](https://openai.devpost.com/resources)

The official rules take precedence if they change. This matrix records the requirement text as checked against the judge-facing repository and release candidate.

| Official requirement or guidance | PromptTripwire evidence | Status |
|---|---|---|
| Submission period ends July 21, 2026 at 17:00 PT (July 22 at 09:00 JST). | `docs/BUILD_WEEK.md` uses the JST deadline and keeps the final day for verification/submission. | Ready |
| Build a project with Codex and GPT-5.6 in an eligible track. | Developer Tools; Codex App Server runs planning/execution and GPT-5.6 performs schema-constrained comparison. | Ready |
| The project installs and runs consistently on the declared platform. | macOS arm64 archive, checksum, installer/uninstaller, pinned Node/Codex requirements, artifact smoke script. | Ready |
| New work must be created during the submission period, or pre-existing work must be clearly separated. | Repository starts during the event; dated specification and implementation commits are listed in `docs/CODEX_COLLABORATION.md`. | Ready |
| Third-party SDKs, APIs, data, and open-source software must be used with authorization and license compliance. | Apache-2.0 project license, `docs/DEPENDENCIES.md`, lockfile license gate, and no third-party data/assets in the judge fixture. | Ready |
| Include an English text description of features and functionality. | `docs/DEVPOST_SUBMISSION.md` contains the English submission draft. | Ready |
| Include a public YouTube demo with audio, less than three minutes, explaining the build and Codex/GPT-5.6 use. | Video field and shot placeholders exist in `docs/DEVPOST_SUBMISSION.md`. | Intentionally excluded from this work request |
| Demo media must not use third-party trademarks, copyrighted music, or other material without permission. | Rights checklist specifies screen capture, system fonts, original copy, no music/logos/stock assets. | Ready for later recording |
| Provide a repository URL; public with relevant licensing, or private and shared with both judge addresses. | Public repository: `https://github.com/shuto-S/prompt-tripwire`; Apache-2.0 is recorded in `LICENSE`, package metadata, and README. Anonymous `HTTP 200` checks passed for the repository and LICENSE URL. | Ready |
| README must explain Codex collaboration, acceleration, human decisions, and GPT-5.6/Codex contributions. | README summary plus the detailed accepted/changed/rejected and dated record in `docs/CODEX_COLLABORATION.md`. | Ready |
| Provide the `/feedback` Codex Session ID for the task where most core functionality was built. | `docs/DEVPOST_SUBMISSION.md` has a non-source placeholder and the exact manual retrieval step. A local task UUID is not treated as the Session ID. | Manual action required |
| Developer tools need installation instructions, supported platforms, and a way to test without rebuilding. | `docs/JUDGE_GUIDE.md`; compiled JavaScript/runtime archive; safe local fixture; recorded read-only replay. | Ready |
| Provide free, unrestricted working-project access through the judging period. | Public repository and `v0.1.0` release are reachable without authentication; no hosted account or paid PromptTripwire service is required. Codex account usage remains under the judge's own OpenAI access. | Ready |
| Submission and testing materials must be English or have English translations. | README, Judge Guide, release notes, fixture, and Devpost draft are English. | Ready |
| Submission must be original, owned by the entrant, and not violate IP/privacy rights. | No copied media or private repository fixture; dependency licenses reviewed; secret/local-path scans gate the artifact. | Ready |
| Stage-one viability: fit the theme and reasonably apply the required tools. | Real Codex/GPT-5.6 vertical slice and executable P0 evidence. | Ready |
| Stage-two criteria are equally weighted: Technological Implementation, Design, Potential Impact, Quality of the Idea. | Submission draft maps evidence to the version-pinned App Server integration, coherent decision flow, specific Codex-user problem, and divergence-to-contract wedge. | Ready |
| Resources guidance: keep the repository testable with clean instructions and sample data. | `docs/JUDGE_GUIDE.md`, safe fixture generator, `npm run verify:release`. | Ready |

## Remaining rule-owned actions

1. Run `/feedback` in the primary Codex task and copy the returned Session ID into Devpost only.
2. Record/upload the public YouTube demo and replace media placeholders.
3. Save and finally submit on Devpost; neither action is performed by repository preparation.

Publication evidence captured on 2026-07-15 JST:

- merged license PR: [#15](https://github.com/shuto-S/prompt-tripwire/pull/15), merge commit `c45feb2d890bf93bf922a5ac085e49aadadb4e55`
- release: [v0.1.0](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.0)
- artifact SHA-256: `fbff8b060d6309d151f5ffdf66fc2c76abf2ebe39da4122195bba2c801856b98`
- anonymous release asset download and local SHA verification passed

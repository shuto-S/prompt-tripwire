# OpenAI Build Week requirements matrix

Checked: 2026-07-19 JST

Authoritative sources:

- [OpenAI Build Week Official Rules](https://openai.devpost.com/rules)
- [OpenAI Build Week Resources](https://openai.devpost.com/resources)

The official rules take precedence if they change. This matrix records the requirement text as checked against the judge-facing repository and prepared v0.1.9 release. The public v0.1.2 demo capture and v0.1.3 through v0.1.8 releases remain historical evidence.

| Official requirement or guidance | PromptTripwire evidence | Status |
|---|---|---|
| Submission period ends July 21, 2026 at 17:00 PT (July 22 at 09:00 JST). | `docs/BUILD_WEEK.md` uses the JST deadline and keeps the final day for verification/submission. | Ready |
| Build a project with Codex and GPT-5.6 in an eligible track. | Developer Tools; Codex App Server runs planning/execution and GPT-5.6 performs schema-constrained comparison. | Ready |
| The project installs and runs consistently on the declared platform. | Prepared v0.1.9 macOS arm64 artifact, pinned Node/Codex requirements, transactional install/upgrade, owned uninstall boundaries, artifact smoke script, and two-build reproducibility gate. It preserves v0.1.8 plan-command guidance and earlier Plugin/UI boundaries while requiring bare inspection program names without weakening unknown-action denial. Public-asset and real Plugin verification are release gates. | Candidate verification pending |
| New work must be created during the submission period, or pre-existing work must be clearly separated. | Repository starts during the event; dated specification and implementation commits are listed in `docs/CODEX_COLLABORATION.md`. | Ready |
| Third-party SDKs, APIs, data, and open-source software must be used with authorization and license compliance. | Apache-2.0 project license, `docs/DEPENDENCIES.md`, lockfile license gate, and no third-party data/assets in the judge fixture. | Ready |
| Include an English text description of features and functionality. | `docs/DEVPOST_SUBMISSION.md` contains the English submission draft. | Ready |
| Include a public YouTube demo with audio, less than three minutes, explaining the build and Codex/GPT-5.6 use. | The repository contains the final local v0.1.2 video, English sidecar/embedded captions, narration, and evidence notes in `docs/demo/`; runtime is 2:52.862 and the content explains Codex planning/execution plus GPT-5.6 comparison. | Local media ready; pending public YouTube publication and anonymous playback check |
| Demo media must not use third-party trademarks, copyrighted music, or other material without permission. | The final media uses owned product capture, original copy, a macOS system voice, and system fonts, with no music, third-party logos, stock assets, private repository content, capability token, or secret. | Ready |
| Provide a repository URL; public with relevant licensing, or private and shared with both judge addresses. | Public repository: `https://github.com/shuto-S/prompt-tripwire`; Apache-2.0 is recorded in `LICENSE`, package metadata, and README. Anonymous `HTTP 200` checks passed for the repository and LICENSE URL. | Ready |
| README must explain Codex collaboration, acceleration, human decisions, and GPT-5.6/Codex contributions. | README summary plus the detailed accepted/changed/rejected and dated record in `docs/CODEX_COLLABORATION.md`. | Ready |
| Provide the `/feedback` Codex Session ID for the task where most core functionality was built. | The retained primary session was uploaded through App Server `feedback/upload` on 2026-07-15 and the returned Session ID was captured outside the repository for Devpost entry. | Pending final Devpost entry |
| Developer tools need installation instructions, supported platforms, and a way to test without rebuilding. | `docs/JUDGE_GUIDE.md`; prepared v0.1.9 compiled JavaScript/runtime artifact; safe local fixture; recorded read-only replay. | Candidate verification pending |
| Provide free, unrestricted working-project access through the judging period. | The public repository and v0.1.2 through v0.1.8 releases are reachable without authentication and were anonymously verified. v0.1.9 publication remains pending. No hosted account or paid PromptTripwire service is required; Codex usage remains under the judge's own OpenAI access. | Continue monitoring; v0.1.9 pending |
| Submission and testing materials must be English or have English translations. | README, Judge Guide, release notes, fixture, Devpost draft, demo narration, and 74-cue caption file are English. | Ready |
| Submission must be original, owned by the entrant, and not violate IP/privacy rights. | Final repository media is owned and reviewed; no copied media or private repository fixture is used; dependency licenses are reviewed; secret/local-path scans gate the artifact. | Ready |
| Stage-one viability: fit the theme and reasonably apply the required tools. | Real Codex/GPT-5.6 vertical slice and executable P0 evidence. | Ready |
| Stage-two criteria are equally weighted: Technological Implementation, Design, Potential Impact, Quality of the Idea. | Submission draft maps evidence to the version-pinned App Server integration, coherent decision flow, specific Codex-user problem, and divergence-to-contract wedge. | Ready |
| Resources guidance: keep the repository testable with clean instructions and sample data. | `docs/JUDGE_GUIDE.md`, safe fixture generator, `npm run verify:release`. | Ready |

## Remaining rule-owned actions

1. Present the completed v0.1.2-capture demo, title, description, visibility, English captions, and thumbnail for explicit human confirmation; only then upload it to public YouTube and verify playback anonymously.
2. Prepare the complete Devpost fields, attachments, links, and dedicated Session ID placement, then obtain a separate explicit human confirmation before final submission. The Session ID remains outside the repository.

Publication evidence through 2026-07-19 JST:

- merged license PR: [#15](https://github.com/shuto-S/prompt-tripwire/pull/15), merge commit `c45feb2d890bf93bf922a5ac085e49aadadb4e55`
- Plugin-enabled release PR: [#20](https://github.com/shuto-S/prompt-tripwire/pull/20), merge commit `1b1fd6156eda3382132633a777f503f448b09852`
- child-Plugin isolation release PR: [#26](https://github.com/shuto-S/prompt-tripwire/pull/26), merge commit `58119517e3bd128d36467f8cf1315b8d18f091d6`
- Decision Inbox localization PR: [#28](https://github.com/shuto-S/prompt-tripwire/pull/28), merge commit `da19c01c30df58d0eff44a2c0f5a55bf7b177a5e`
- v0.1.5 release PR: [#29](https://github.com/shuto-S/prompt-tripwire/pull/29), merge commit `26882c31d76e4f388ca59420d3fb41494c2b5973`
- v0.1.6 documentation-correction release PR: [#30](https://github.com/shuto-S/prompt-tripwire/pull/30), merge commit `cf54fb767b6677bfe60f2f5a4ffd6e3b74dd1400`
- v0.1.7 coordinated-negation precision release: PR [#32](https://github.com/shuto-S/prompt-tripwire/pull/32), merge commit `23db6619a2f3aa83f2c388621538e4e63063184c`
- v0.1.8 plan-command guidance release: PR [#33](https://github.com/shuto-S/prompt-tripwire/pull/33), merge commit `57cdbde82320d16b9057e059b704063322799877`
- v0.1.9 bare-program guidance release: pending PR, publication, and anonymous verification
- public releases: [v0.1.8](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.8), [v0.1.7](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.7), [v0.1.6](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.6), [v0.1.5](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.5), [v0.1.4](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.4), [v0.1.3](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.3), and [v0.1.2](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.2); v0.1.1 and v0.1.0 remain preserved as earlier evidence
- anonymously verified v0.1.8 macOS arm64 artifact SHA-256: `0b5ca45f3cf497917df9f0b1c531aa4e8cf5b9e75eb46e47128c5fa3d09e351c`
- anonymously verified v0.1.7 macOS arm64 artifact SHA-256: `c6fe5b1f51bfd81dff7ebdce5f5f5f46eef01c6cb4dced0fd7213723ba9611f6`
- anonymously verified v0.1.6 macOS arm64 artifact SHA-256: `1b74c4c935e0fec1857b88b2a592f776c01f104a4042d224ef3ac1265fe83c33`
- anonymously verified v0.1.5 macOS arm64 artifact SHA-256: `b9df44c8a44d255a98f00953003d41e743e53059eec26ef79980730dccc5beaf`
- anonymously verified v0.1.4 macOS arm64 artifact SHA-256: `02a30d1f202e18da556aff576ef6d01d82970973e2566639e116615cc6aea4fa`
- anonymously verified v0.1.3 macOS arm64 artifact SHA-256: `2328e2673ab2fd67d4bd3043dc2c838fc584fad1a10719da28dcbcfd38156682`
- anonymously verified v0.1.2 macOS arm64 artifact SHA-256: `73d61b8262b5c81be558a89b800ddaa0f5d71c4c9e46679893c3c93b1bbfee3f`
- historical v0.1.1 artifact SHA-256: `7a29de3241bab426b2e9b9edd84a6d6f01dd0fc1bf13d71da3927a4a83277f50`
- anonymous v0.1.1 asset download, local SHA verification, and complete 918-file release verification passed

The final local v0.1.2 capture is available through
[`docs/demo/README.md`](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md) and is intentionally excluded from the
judge archive. Its live Inbox scene is an untouched API-key-free v0.1.2 inspect;
the separately disclosed contract/execution/report scenes use an earlier
human-approved safe-fixture run. It is not represented as footage of the
v0.1.9 judge distribution. v0.1.9 publication, archive digest, packaged
instruction check, anonymous download, isolated install, and real Plugin
approval-to-report rehearsal remain release gates; the public YouTube URL also
remains pending. The v0.1.8 archive and checksum remain immutable historical
evidence and do not verify v0.1.9.

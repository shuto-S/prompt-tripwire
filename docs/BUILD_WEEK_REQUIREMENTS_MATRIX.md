# OpenAI Build Week requirements matrix

Checked: 2026-07-19 JST

Authoritative sources:

- [OpenAI Build Week Official Rules](https://openai.devpost.com/rules)
- [OpenAI Build Week Resources](https://openai.devpost.com/resources)

The official rules take precedence if they change. This matrix records the requirement text as checked against the judge-facing repository and v0.1.4 patch release candidate. The public v0.1.2 demo capture and v0.1.3 release remain historical evidence.

| Official requirement or guidance | PromptTripwire evidence | Status |
|---|---|---|
| Submission period ends July 21, 2026 at 17:00 PT (July 22 at 09:00 JST). | `docs/BUILD_WEEK.md` uses the JST deadline and keeps the final day for verification/submission. | Ready |
| Build a project with Codex and GPT-5.6 in an eligible track. | Developer Tools; Codex App Server runs planning/execution and GPT-5.6 performs schema-constrained comparison. | Ready |
| The project installs and runs consistently on the declared platform. | v0.1.4 macOS arm64 candidate, pinned Node/Codex requirements, transactional install/upgrade, owned uninstall boundaries, artifact smoke script, and two-build reproducibility gate. The patch disables child Plugin contributions without rewriting the task, retains deterministic re-entry, preserves custom Codex-home login only for App Server, and validates every basename-only or multi-target search operand. | Pending final v0.1.4 verification/publication |
| New work must be created during the submission period, or pre-existing work must be clearly separated. | Repository starts during the event; dated specification and implementation commits are listed in `docs/CODEX_COLLABORATION.md`. | Ready |
| Third-party SDKs, APIs, data, and open-source software must be used with authorization and license compliance. | Apache-2.0 project license, `docs/DEPENDENCIES.md`, lockfile license gate, and no third-party data/assets in the judge fixture. | Ready |
| Include an English text description of features and functionality. | `docs/DEVPOST_SUBMISSION.md` contains the English submission draft. | Ready |
| Include a public YouTube demo with audio, less than three minutes, explaining the build and Codex/GPT-5.6 use. | The repository contains the final local v0.1.2 video, English sidecar/embedded captions, narration, and evidence notes in `docs/demo/`; runtime is 2:52.862 and the content explains Codex planning/execution plus GPT-5.6 comparison. | Local media ready; pending public YouTube publication and anonymous playback check |
| Demo media must not use third-party trademarks, copyrighted music, or other material without permission. | The final media uses owned product capture, original copy, a macOS system voice, and system fonts, with no music, third-party logos, stock assets, private repository content, capability token, or secret. | Ready |
| Provide a repository URL; public with relevant licensing, or private and shared with both judge addresses. | Public repository: `https://github.com/shuto-S/prompt-tripwire`; Apache-2.0 is recorded in `LICENSE`, package metadata, and README. Anonymous `HTTP 200` checks passed for the repository and LICENSE URL. | Ready |
| README must explain Codex collaboration, acceleration, human decisions, and GPT-5.6/Codex contributions. | README summary plus the detailed accepted/changed/rejected and dated record in `docs/CODEX_COLLABORATION.md`. | Ready |
| Provide the `/feedback` Codex Session ID for the task where most core functionality was built. | The retained primary session was uploaded through App Server `feedback/upload` on 2026-07-15 and the returned Session ID was captured outside the repository for Devpost entry. | Pending final Devpost entry |
| Developer tools need installation instructions, supported platforms, and a way to test without rebuilding. | `docs/JUDGE_GUIDE.md`; v0.1.4 compiled JavaScript/runtime candidate path; safe local fixture; recorded read-only replay. | Pending final v0.1.4 artifact verification |
| Provide free, unrestricted working-project access through the judging period. | The public repository and v0.1.2/v0.1.3 releases are reachable without authentication and were anonymously verified. The v0.1.4 patch distribution still needs GitHub publication and anonymous verification. No hosted account or paid PromptTripwire service is required; Codex usage remains under the judge's own OpenAI access. | Pending v0.1.4 publication |
| Submission and testing materials must be English or have English translations. | README, Judge Guide, release notes, fixture, Devpost draft, demo narration, and 74-cue caption file are English. | Ready |
| Submission must be original, owned by the entrant, and not violate IP/privacy rights. | Final repository media is owned and reviewed; no copied media or private repository fixture is used; dependency licenses are reviewed; secret/local-path scans gate the artifact. | Ready |
| Stage-one viability: fit the theme and reasonably apply the required tools. | Real Codex/GPT-5.6 vertical slice and executable P0 evidence. | Ready |
| Stage-two criteria are equally weighted: Technological Implementation, Design, Potential Impact, Quality of the Idea. | Submission draft maps evidence to the version-pinned App Server integration, coherent decision flow, specific Codex-user problem, and divergence-to-contract wedge. | Ready |
| Resources guidance: keep the repository testable with clean instructions and sample data. | `docs/JUDGE_GUIDE.md`, safe fixture generator, `npm run verify:release`. | Ready |

## Remaining rule-owned actions

1. Run the complete v0.1.4 source, reproducibility, and release-artifact verification gates.
2. Publish the v0.1.4 archive/checksum and verify the repository, release, and judge instructions anonymously.
3. Present the completed v0.1.2-capture demo, title, description, visibility, English captions, and thumbnail for explicit human confirmation; only then upload it to public YouTube and verify playback anonymously.
4. Prepare the complete Devpost fields, attachments, links, and dedicated Session ID placement, then obtain a separate explicit human confirmation before final submission. The Session ID remains outside the repository.

Publication evidence through 2026-07-19 JST:

- merged license PR: [#15](https://github.com/shuto-S/prompt-tripwire/pull/15), merge commit `c45feb2d890bf93bf922a5ac085e49aadadb4e55`
- Plugin-enabled release PR: [#20](https://github.com/shuto-S/prompt-tripwire/pull/20), merge commit `1b1fd6156eda3382132633a777f503f448b09852`
- public releases: [v0.1.3](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.3) and [v0.1.2](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.2); v0.1.1 and v0.1.0 remain preserved as earlier evidence
- anonymously verified v0.1.3 macOS arm64 artifact SHA-256: `2328e2673ab2fd67d4bd3043dc2c838fc584fad1a10719da28dcbcfd38156682`
- anonymously verified v0.1.2 macOS arm64 artifact SHA-256: `73d61b8262b5c81be558a89b800ddaa0f5d71c4c9e46679893c3c93b1bbfee3f`
- historical v0.1.1 artifact SHA-256: `7a29de3241bab426b2e9b9edd84a6d6f01dd0fc1bf13d71da3927a4a83277f50`
- anonymous v0.1.1 asset download, local SHA verification, and complete 918-file release verification passed

The final local v0.1.2 capture is available through
[`docs/demo/README.md`](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md) and is intentionally excluded from the
judge archive. Its live Inbox scene is an untouched API-key-free v0.1.2 inspect;
the separately disclosed contract/execution/report scenes use an earlier
human-approved safe-fixture run. It is not represented as footage of the
v0.1.4 compatibility patch. The v0.1.4 GitHub Release URL, archive digest,
anonymous-download check, and public YouTube URL remain pending. No checksum
from v0.1.1, v0.1.2, or v0.1.3 verifies the v0.1.4 archive.

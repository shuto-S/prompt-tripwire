# OpenAI Build Week requirements matrix

Checked: 2026-07-18 JST

Authoritative sources:

- [OpenAI Build Week Official Rules](https://openai.devpost.com/rules)
- [OpenAI Build Week Resources](https://openai.devpost.com/resources)

The official rules take precedence if they change. This matrix records the requirement text as checked against the judge-facing repository and v0.1.2 distribution source.

| Official requirement or guidance | PromptTripwire evidence | Status |
|---|---|---|
| Submission period ends July 21, 2026 at 17:00 PT (July 22 at 09:00 JST). | `docs/BUILD_WEEK.md` uses the JST deadline and keeps the final day for verification/submission. | Ready |
| Build a project with Codex and GPT-5.6 in an eligible track. | Developer Tools; Codex App Server runs planning/execution and GPT-5.6 performs schema-constrained comparison. | Ready |
| The project installs and runs consistently on the declared platform. | v0.1.2 macOS arm64 distribution, pinned Node/Codex requirements, transactional install/upgrade, owned uninstall boundaries, artifact smoke script, and two-build reproducibility gate. | Pending final v0.1.2 verification/publication |
| New work must be created during the submission period, or pre-existing work must be clearly separated. | Repository starts during the event; dated specification and implementation commits are listed in `docs/CODEX_COLLABORATION.md`. | Ready |
| Third-party SDKs, APIs, data, and open-source software must be used with authorization and license compliance. | Apache-2.0 project license, `docs/DEPENDENCIES.md`, lockfile license gate, and no third-party data/assets in the judge fixture. | Ready |
| Include an English text description of features and functionality. | `docs/DEVPOST_SUBMISSION.md` contains the English submission draft. | Ready |
| Include a public YouTube demo with audio, less than three minutes, explaining the build and Codex/GPT-5.6 use. | The repository contains the final local v0.1.2 video, English sidecar/embedded captions, narration, and evidence notes in `docs/demo/`; runtime is 2:52.862 and the content explains Codex planning/execution plus GPT-5.6 comparison. | Local media ready; pending public YouTube publication and anonymous playback check |
| Demo media must not use third-party trademarks, copyrighted music, or other material without permission. | The final media uses owned product capture, original copy, a macOS system voice, and system fonts, with no music, third-party logos, stock assets, private repository content, capability token, or secret. | Ready |
| Provide a repository URL; public with relevant licensing, or private and shared with both judge addresses. | Public repository: `https://github.com/shuto-S/prompt-tripwire`; Apache-2.0 is recorded in `LICENSE`, package metadata, and README. Anonymous `HTTP 200` checks passed for the repository and LICENSE URL. | Ready |
| README must explain Codex collaboration, acceleration, human decisions, and GPT-5.6/Codex contributions. | README summary plus the detailed accepted/changed/rejected and dated record in `docs/CODEX_COLLABORATION.md`. | Ready |
| Provide the `/feedback` Codex Session ID for the task where most core functionality was built. | The retained primary session was uploaded through App Server `feedback/upload` on 2026-07-15 and the returned Session ID was captured outside the repository for Devpost entry. | Pending final Devpost entry |
| Developer tools need installation instructions, supported platforms, and a way to test without rebuilding. | `docs/JUDGE_GUIDE.md`; v0.1.2 compiled JavaScript/runtime distribution path; safe local fixture; recorded read-only replay. | Pending final artifact verification |
| Provide free, unrestricted working-project access through the judging period. | The public repository and historical `v0.1.1` release are reachable without authentication. The v0.1.2 distribution still needs GitHub publication and anonymous verification. No hosted account or paid PromptTripwire service is required; Codex usage remains under the judge's own OpenAI access. | Pending v0.1.2 publication |
| Submission and testing materials must be English or have English translations. | README, Judge Guide, release notes, fixture, Devpost draft, demo narration, and 74-cue caption file are English. | Ready |
| Submission must be original, owned by the entrant, and not violate IP/privacy rights. | Final repository media is owned and reviewed; no copied media or private repository fixture is used; dependency licenses are reviewed; secret/local-path scans gate the artifact. | Ready |
| Stage-one viability: fit the theme and reasonably apply the required tools. | Real Codex/GPT-5.6 vertical slice and executable P0 evidence. | Ready |
| Stage-two criteria are equally weighted: Technological Implementation, Design, Potential Impact, Quality of the Idea. | Submission draft maps evidence to the version-pinned App Server integration, coherent decision flow, specific Codex-user problem, and divergence-to-contract wedge. | Ready |
| Resources guidance: keep the repository testable with clean instructions and sample data. | `docs/JUDGE_GUIDE.md`, safe fixture generator, `npm run verify:release`. | Ready |

## Remaining rule-owned actions

1. Run the complete v0.1.2 source, reproducibility, and release-artifact verification gates.
2. Publish the v0.1.2 archive/checksum and verify the repository, release, and judge instructions anonymously.
3. Upload the completed v0.1.2 demo and English captions to public YouTube, make YouTube the primary link, and verify playback anonymously.
4. Save and finally submit on Devpost; neither external action is performed by repository preparation.

Publication evidence captured on 2026-07-16 JST:

- merged license PR: [#15](https://github.com/shuto-S/prompt-tripwire/pull/15), merge commit `c45feb2d890bf93bf922a5ac085e49aadadb4e55`
- Plugin-enabled release PR: [#20](https://github.com/shuto-S/prompt-tripwire/pull/20), merge commit `1b1fd6156eda3382132633a777f503f448b09852`
- historical release: [v0.1.1](https://github.com/shuto-S/prompt-tripwire/releases/tag/v0.1.1); v0.1.0 remains preserved as earlier evidence
- historical v0.1.1 artifact SHA-256: `7a29de3241bab426b2e9b9edd84a6d6f01dd0fc1bf13d71da3927a4a83277f50`
- anonymous v0.1.1 asset download, local SHA verification, and complete 918-file release verification passed

The final local v0.1.2 demo media is available through
[`docs/demo/README.md`](https://github.com/shuto-S/prompt-tripwire/blob/v0.1.2/docs/demo/README.md) and is intentionally excluded from the
judge archive. Its live Inbox scene is an untouched API-key-free v0.1.2 inspect;
the separately disclosed contract/execution/report scenes use an earlier
human-approved safe-fixture run. The v0.1.2 GitHub Release URL, archive digest,
anonymous-download check, and public YouTube URL remain pending. The historical
v0.1.1 checksum does not verify the v0.1.2 archive.

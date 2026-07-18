import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  containsSecretLikeText,
  createDecisionRound,
  denyPermissionExpansion,
  evaluateDeterministicPolicy as evaluatePolicy,
  matchCommandRequest,
  matchNamedAction,
  matchNetworkRequest,
  matchPathRequest,
  matchesRepositoryPath,
  normalizeRepositoryRelativePath,
  redactText,
  sanitizeForExport,
} from "../../packages/policy/dist/index.js";

function evaluateDeterministicPolicy(input) {
  return evaluatePolicy({ task: "", ...input });
}

function plan(overrides = {}) {
  return {
    probeId: "probe_1",
    summary: "Implement a local validation helper",
    assumptions: [],
    intendedBehavior: ["Validate input locally"],
    filesToChange: ["src/validator.ts"],
    components: ["validator"],
    dataChanges: [],
    publicApiChanges: [],
    dependencyChanges: [],
    commands: ["npm run test:unit"],
    externalEffects: [],
    permissionChanges: [],
    compatibilityImpacts: [],
    reversibility: "reversible",
    unknowns: [],
    ...overrides,
  };
}

test("AC-004: unanimous model output cannot remove deterministic blockers", () => {
  const risky = plan({
    externalEffects: ["deploy to production", "apply database migration", "git push remote write"],
    permissionChanges: ["rotate secret token and expand permission"],
  });
  const blockers = evaluateDeterministicPolicy({
    plans: [risky, { ...risky, probeId: "probe_2" }, { ...risky, probeId: "probe_3" }],
    modelConsensusSafe: true,
  });
  const triggers = new Set(blockers.map((blocker) => blocker.trigger));
  for (const trigger of [
    "deploy_release_publish",
    "production",
    "migration",
    "remote_write",
    "secret",
    "permission",
  ]) {
    assert.equal(triggers.has(trigger), true, `missing ${trigger}`);
  }
  assert.equal(createDecisionRound(blockers).executionAllowed, false);
});

test("AC-004: original task intent remains a deterministic backstop", () => {
  const safePlans = [plan(), plan({ probeId: "probe_2" }), plan({ probeId: "probe_3" })];
  const blockers = evaluateDeterministicPolicy({
    task: "Deploy to production and git push the resulting branch.",
    plans: safePlans,
    modelConsensusSafe: true,
  });
  const triggers = new Set(blockers.map((blocker) => blocker.trigger));
  assert.equal(triggers.has("deploy_release_publish"), true);
  assert.equal(triggers.has("remote_write"), true);
  assert.equal(
    blockers.every((blocker) => blocker.evidenceRefs.includes("task:normalized")),
    true,
  );
  assert.equal(
    blockers.every((blocker) => blocker.affectedComponents.length === 0),
    true,
  );
  assert.equal(createDecisionRound(blockers).executionAllowed, false);
});

test("deterministic-v2 recognizes concise English and Japanese high-impact tasks", () => {
  const cases = [
    ["Merge PR #12.", ["remote_write"]],
    ["Approve PR #12.", ["remote_write"]],
    ["Close issue #12.", ["remote_write"]],
    ["Ship v0.1.2.", ["deploy_release_publish"]],
    ["Tag v0.1.2 and push the tag.", ["deploy_release_publish", "remote_write"]],
    ["Remove all rows from the users table.", ["destructive_data"]],
    ["Apply the approved change to production.", ["production"]],
    ["Grant Alice owner access.", ["permission"]],
    ["PR #12をマージしてください。", ["remote_write"]],
    ["PR #12を承認してください。", ["remote_write"]],
    ["Issue #12を閉じてください。", ["remote_write"]],
    ["v0.1.2のタグを作ってpushしてください。", ["deploy_release_publish", "remote_write"]],
    ["本番DBの全行を消してください。", ["destructive_data", "production"]],
    ["S3バケットを空にしてください。", ["destructive_data"]],
    ["本番へ反映してください。", ["production"]],
    ["Aliceを管理者にしてください。", ["permission"]],
  ];
  for (const [task, expected] of cases) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).map((blocker) => blocker.trigger),
    );
    for (const trigger of expected) {
      assert.equal(triggers.has(trigger), true, `${task} missed ${trigger}`);
    }
  }
});

test("concise high-impact vocabulary remains safe when explicitly negated or documented", () => {
  for (const task of [
    "Do not merge PR #12.",
    "Do not approve PR #12.",
    "Do not tag or push v0.1.2.",
    "Do not remove any rows from the users table.",
    "Do not apply this change to production.",
    "Do not deploy and you should not push the branch.",
    "Never delete data and please do not run the migration.",
    "Document how to merge PR #12.",
    "Document how to tag and push v0.1.2.",
    "PR #12はマージしないでください。",
    "本番DBの全行は消さないでください。",
    "本番へ反映しないでください。",
    "v0.1.2のタグは作成しないでください。",
    "PR #12をマージする手順を文書化してください。",
    "本番へ反映する手順をREADMEに追加してください。",
    "pushする方法を文書化してください。",
    "デプロイするテストを追加してください。",
  ]) {
    assert.deepEqual(evaluateDeterministicPolicy({ task, plans: [plan()] }), [], task);
  }
});

test("Japanese documentation controls do not suppress an actual operation", () => {
  for (const [task, expected] of [
    ["PR #12をマージしてください。", "remote_write"],
    ["本番へ反映する手順を実行してください。", "production"],
    ["pushしてください。", "remote_write"],
    ["デプロイしてください。", "deploy_release_publish"],
  ]) {
    assert.equal(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).some(
        (blocker) => blocker.trigger === expected,
      ),
      true,
      `${task} missed ${expected}`,
    );
  }
});

test("deterministic-v2 backstops remote mutations and network repository operations", () => {
  const cases = [
    ["Delete GitHub issue #12.", ["remote_write"]],
    ["Run gh issue delete 12.", ["remote_write"]],
    ["Clone https://github.com/example/repo.git.", ["network"]],
    ["Run git clone https://github.com/example/repo.git.", ["network"]],
    ["Send a message to Slack.", ["remote_write"]],
    ["Send Slack a message.", ["remote_write"]],
    ["Post to Slack.", ["remote_write"]],
    ["Run gh repo delete owner/repo.", ["remote_write"]],
    [
      "Upload the release asset with gh release upload.",
      ["deploy_release_publish", "remote_write"],
    ],
    ["Upload a video to YouTube.", ["deploy_release_publish", "remote_write"]],
    ["Upload to YouTube.", ["deploy_release_publish", "remote_write"]],
    ["Run git fetch origin.", ["network"]],
    ["Pull the latest changes from origin.", ["network"]],
    ["Update Jira issue PROJ-12.", ["remote_write"]],
    ["Update Jira.", ["remote_write"]],
    ["Update the Notion page.", ["remote_write"]],
    ["Update Notion.", ["remote_write"]],
    ["Delete the GitHub repository.", ["remote_write"]],
    ["Run gh secret set API_KEY.", ["remote_write", "secret", "network"]],
    ["Run aws s3 cp file s3://bucket/key.", ["remote_write", "network"]],
    [
      "Run kubectl apply -f deployment.yaml.",
      ["deploy_release_publish", "remote_write", "network"],
    ],
    ["Run git ls-remote origin.", ["network"]],
    ["Run ssh example.com.", ["network"]],
    ["Send an email to fixture@example.invalid.", ["remote_write"]],
    ["Post a message to Google Chat.", ["remote_write"]],
    ["Update the Google Sheet.", ["remote_write"]],
    ["Create a page in Notion.", ["remote_write"]],
    ["Remove a GitHub collaborator.", ["remote_write", "permission"]],
    ["Change the branch protection rules.", ["remote_write", "permission"]],
    ["Delete a GitHub release.", ["deploy_release_publish", "remote_write"]],
    ["GitHub Issue #12を削除してください。", ["remote_write"]],
    ["gh issue delete 12を実行してください。", ["remote_write"]],
    ["GitHubからリポジトリをcloneしてください。", ["network"]],
    ["git fetchしてください。", ["network"]],
    ["originからpullしてください。", ["network"]],
    ["Slackにメッセージを送ってください。", ["remote_write"]],
    ["JiraのIssueを更新してください。", ["remote_write"]],
    ["Jiraを更新してください。", ["remote_write"]],
    ["Notionのページを更新してください。", ["remote_write"]],
    ["Notionを更新してください。", ["remote_write"]],
    ["GitHubリポジトリを削除してください。", ["remote_write"]],
    ["Google Chatにメッセージを投稿してください。", ["remote_write"]],
    ["Googleスプレッドシートを更新してください。", ["remote_write"]],
    ["Notionにページを作成してください。", ["remote_write"]],
    ["GitHubコラボレーターを削除してください。", ["remote_write", "permission"]],
    ["ブランチ保護ルールを変更してください。", ["remote_write", "permission"]],
    ["GitHubリリースを削除してください。", ["deploy_release_publish", "remote_write"]],
    ["YouTubeに動画をアップロードしてください。", ["deploy_release_publish", "remote_write"]],
    [
      "gh release uploadでリリースアセットをアップロードしてください。",
      ["deploy_release_publish", "remote_write"],
    ],
  ];
  for (const [task, expected] of cases) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).map((blocker) => blocker.trigger),
    );
    for (const trigger of expected) {
      assert.equal(triggers.has(trigger), true, `${task} missed ${trigger}`);
    }
  }
});

test("second hardening task vocabulary closes high-impact red-team gaps", () => {
  const cases = [
    ["Read .env.", ["secret"]],
    ["Run cat .env.", ["secret"]],
    ["Open https://example.invalid/docs.", ["network"]],
    ["Browse the web for the current documentation.", ["network"]],
    ["Run npm ci.", ["dependency", "network"]],
    ["Log in to GitHub.", ["authentication"]],
    ["Authenticate with AWS.", ["authentication"]],
    ["Invite Alice to the GitHub repository.", ["permission", "remote_write"]],
    ["Add Alice to the GitHub repository.", ["permission", "remote_write"]],
    ["Buy credits.", ["billing"]],
    ["Purchase the paid plan.", ["billing"]],
    ["Run DELETE FROM users.", ["destructive_data"]],
    ["Anonymize customer records.", ["destructive_data"]],
    ["Run git send-pack origin main.", ["network", "remote_write"]],
    ["Send a Slack message.", ["remote_write"]],
    ["Remove the /v1/users endpoint.", ["breaking_api"]],
    ["Remove the public API method.", ["breaking_api"]],
    ["Edit /etc/hosts.", ["scope_expansion"]],
    ["The implementation detail is TBD.", ["unknown"]],
    ["Send an email to fixture@example.invalid.", ["remote_write"]],
    ["Send an email.", ["remote_write"]],
    ["Send an SMS notification.", ["remote_write"]],
    ["Send an SMS message.", ["remote_write"]],
    ["Create a Google Calendar event.", ["remote_write"]],
    ["Create an event in Google Calendar.", ["remote_write"]],
    ["Upload the object to S3.", ["network", "remote_write"]],
    ["Write an object to S3.", ["network", "remote_write"]],
  ];
  for (const [task, expected] of cases) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).map((blocker) => blocker.trigger),
    );
    for (const trigger of expected) {
      assert.equal(triggers.has(trigger), true, `${task} missed ${trigger}`);
    }
  }
});

test("final hardening task vocabulary covers repository, S3, release, and Slack actions", () => {
  const cases = [
    ["Archive the GitHub repository.", ["remote_write"]],
    ["Rename the GitHub repository.", ["remote_write"]],
    ["Lock GitHub issue #12.", ["remote_write"]],
    ["Transfer GitHub issue #12.", ["remote_write"]],
    ["Sync the build artifacts to S3.", ["network", "remote_write"]],
    ["Download the latest release from GitHub.", ["network"]],
    ["Create a notification in Slack.", ["remote_write"]],
    ["GitHubリポジトリをアーカイブしてください。", ["remote_write"]],
    ["ビルド成果物をS3に同期してください。", ["network", "remote_write"]],
  ];
  for (const [task, expected] of cases) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).map((blocker) => blocker.trigger),
    );
    for (const trigger of expected) {
      assert.equal(triggers.has(trigger), true, `${task} missed ${trigger}`);
    }
  }
});

test("final hardening recognizes mutation synonyms without treating release artifacts as releases", () => {
  const mutationCases = [
    ["Make the GitHub repository read-only by archiving it.", ["remote_write"]],
    ["Change the GitHub repository name.", ["remote_write"]],
    ["Move issue #12 to another GitHub repository.", ["remote_write"]],
    ["Mirror the build artifacts into S3.", ["network", "remote_write"]],
    ["Notify the team in Slack.", ["remote_write"]],
    ["GitHubリポジトリの名前を変更してください。", ["remote_write"]],
    ["GitHub Issue #12を別のリポジトリへ移動してください。", ["remote_write"]],
    ["ビルド成果物をS3へミラーしてください。", ["network", "remote_write"]],
    ["Slackでチームに通知してください。", ["remote_write"]],
  ];
  for (const [task, expected] of mutationCases) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).map((blocker) => blocker.trigger),
    );
    for (const trigger of expected) {
      assert.equal(triggers.has(trigger), true, `${task} missed ${trigger}`);
    }
  }

  for (const task of [
    "Release the artifact.",
    "We need to release v0.1.2.",
    "Can you release the package?",
  ]) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).map((blocker) => blocker.trigger),
    );
    assert.equal(triggers.has("deploy_release_publish"), true, task);
  }

  const releaseArtifactCases = [
    ["Download the release artifact from GitHub.", ["network"]],
    ["Fetch the newest GitHub release artifact.", ["network"]],
    ["Retrieve the release artifact from GitHub.", ["network"]],
    ["Inspect the release artifact locally.", []],
    ["Verify the release artifact checksum.", []],
    ["Update release artifact verification tests.", []],
    ["Inspect the archived GitHub repository metadata locally.", []],
    ["Inspect the renamed GitHub repository metadata locally.", []],
  ];
  for (const [task, expected] of releaseArtifactCases) {
    const triggers = [
      ...new Set(
        evaluateDeterministicPolicy({ task, plans: [plan()] }).map((blocker) => blocker.trigger),
      ),
    ].sort();
    assert.deepEqual(triggers, [...expected].sort(), task);
  }
});

test("final task vocabulary respects negation, docs, and component meta contexts", () => {
  for (const task of [
    "Do not archive or rename the GitHub repository.",
    "Do not lock or transfer GitHub issue #12.",
    "Do not sync build artifacts to S3.",
    "Do not download the latest release from GitHub.",
    "Do not create a notification in Slack.",
    "Document how to archive GitHub repositories.",
    "Add a parser for gh repo archive commands.",
    "Update the repository archive client tests.",
    "Document how to sync build artifacts to S3.",
    "Update the Slack message component.",
    "Update the Notion page renderer.",
    "Do not make the GitHub repository read-only.",
    "Document how to change the GitHub repository name.",
    "Add tests for moving GitHub issues between repositories.",
    "Document how to mirror build artifacts into S3.",
    "Add tests for notifying the team in Slack.",
    "GitHubリポジトリの名前は変更しないでください。",
    "GitHub Issueを別リポジトリへ移動する手順を文書化してください。",
    "S3へ成果物をミラーするテストを追加してください。",
    "Slackで通知する方法を文書化してください。",
    "GitHubリポジトリをアーカイブしないでください。",
    "S3同期の手順を文書化してください。",
  ]) {
    assert.deepEqual(evaluateDeterministicPolicy({ task, plans: [plan()] }), [], task);
  }

  const task = "Document how to archive repositories; then archive the GitHub repository.";
  assert.equal(
    evaluateDeterministicPolicy({ task, plans: [plan()] }).some(
      (blocker) => blocker.trigger === "remote_write",
    ),
    true,
    task,
  );
});

test("comma, without, and how-to scopes preserve negation without hiding later actions", () => {
  for (const task of [
    "Do not send an email, SMS, or Google Calendar invitation.",
    "Work locally without sending an email or posting a Slack message.",
    "Implement locally without opening a URL, browsing the web, or running npm ci.",
    "Document how to send an email, create a Google Calendar event, and upload an object to S3.",
    "Add a how-to for opening a URL and browsing the web.",
  ]) {
    assert.deepEqual(evaluateDeterministicPolicy({ task, plans: [plan()] }), [], task);
  }

  for (const [task, expected] of [
    ["Do not send an email, then create a Google Calendar event.", "remote_write"],
    ["Work without network access, then open https://example.invalid.", "network"],
    ["Document how to send an email; then send an SMS.", "remote_write"],
    ["Without deploying, push the branch to origin.", "remote_write"],
    ["Do not deploy, please push the branch to origin.", "remote_write"],
    ["Never delete data, run the migrations.", "migration"],
    ["Do not install zod, add valibot.", "dependency"],
    ["Do not update Jira, update Notion.", "remote_write"],
    ["Document how to deploy and then deploy it.", "deploy_release_publish"],
  ]) {
    assert.equal(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).some(
        (blocker) => blocker.trigger === expected,
      ),
      true,
      `${task} missed ${expected}`,
    );
  }
});

test("UI labels, models, documentation paths, and command examples are safe prose", () => {
  for (const task of [
    "Add a Publish button.",
    "Rename the Deploy button.",
    "Test the Install button.",
    "Add a Login button.",
    "Create the release notes page.",
    "Add an account model.",
    "Render a production badge.",
    "Update docs/deploy.md.",
    "Edit docs/release-notes.md.",
    "Update .github/workflows/release.yml documentation.",
    "Document the curl -d example.",
    "Add a curl -d example.",
  ]) {
    assert.deepEqual(evaluateDeterministicPolicy({ task, plans: [plan()] }), [], task);
  }

  for (const task of [
    "Add a Publish button, then publish the package.",
    "Create the release notes page, then release the package.",
  ]) {
    assert.equal(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).some(
        (blocker) => blocker.trigger === "deploy_release_publish",
      ),
      true,
      task,
    );
  }
});

test("remote and network task vocabulary respects negation and safe meta contexts", () => {
  for (const task of [
    "Do not delete GitHub issue #12.",
    "Do not run gh issue delete 12.",
    "Do not clone https://github.com/example/repo.git.",
    "Do not run git fetch or git pull.",
    "Do not send a message to Slack.",
    "Do not run gh repo delete owner/repo.",
    "Do not upload a release asset or a video to YouTube.",
    "Do not upload to YouTube.",
    "Do not update the Jira issue or the Notion page.",
    "Do not delete the GitHub repository or release.",
    "Do not run gh secret set API_KEY.",
    "Do not run aws s3 cp file s3://bucket/key.",
    "Do not run kubectl apply -f deployment.yaml.",
    "Do not run git ls-remote or ssh.",
    "Do not send an email to fixture@example.invalid.",
    "Do not post a message to Google Chat.",
    "Do not update the Google Sheet.",
    "Do not create a page in Notion.",
    "Do not remove a GitHub collaborator.",
    "Do not change the branch protection rules.",
    "Document how to delete GitHub issue #12.",
    "Add tests for gh issue delete parsing.",
    "Implement a parser for gh repo delete commands.",
    "Update the gh release upload client tests.",
    "Run the gh release upload parser.",
    "Add a fake GitHub client for gh issue delete responses.",
    "Mock gh issue delete responses.",
    "Document git clone, git fetch, and git pull commands.",
    "Add a parser for git clone URLs.",
    "Update the git pull parser.",
    "Add tests for sending a message to Slack.",
    "Document how to upload videos to YouTube.",
    "Update the Jira client parser.",
    "Update the Jira client.",
    "Update the Notion client.",
    "Update the YouTube upload client tests.",
    "Test the upload to YouTube client.",
    "Document kubectl apply and aws s3 cp commands.",
    "Add a parser for git ls-remote output.",
    "Update the ssh client tests.",
    "Mock gh secret set responses.",
    "Update Google Sheet parser.",
    "Update the Google Sheet client tests.",
    "Update the Notion page parser.",
    "Create a Slack message fixture.",
    "Add tests for sending an email to fixture@example.invalid.",
    "Add tests for posting a message to Google Chat.",
    "Add a collaborator removal fixture.",
    "Update the branch protection client tests.",
    "Mock GitHub release deletion responses.",
    "GitHub Issue #12は削除しないでください。",
    "git fetchとgit pullは実行しないでください。",
    "Slackにメッセージを送信しないでください。",
    "JiraのIssueとNotionのページは更新しないでください。",
    "YouTubeに動画をアップロードしないでください。",
    "YouTubeへアップロードしないでください。",
    "git fetchの手順を文書化してください。",
    "git cloneパーサーを実装してください。",
    "gh repo deleteクライアントのテストを追加してください。",
    "Slackにメッセージを送る方法を文書化してください。",
    "JiraのIssue更新パーサーを実装してください。",
    "Notionページ更新のテストを追加してください。",
    "YouTubeに動画をアップロードするテストを追加してください。",
    "Googleスプレッドシート更新パーサーを実装してください。",
    "Notionページ作成のテストを追加してください。",
    "Google Chatへの投稿方法を文書化してください。",
    "GitHubコラボレーター削除のフィクスチャを追加してください。",
    "ブランチ保護ルール更新クライアントのテストを追加してください。",
    "GitHubリリース削除レスポンスをモックしてください。",
  ]) {
    assert.deepEqual(evaluateDeterministicPolicy({ task, plans: [plan()] }), [], task);
  }

  for (const task of ["Update Jira.", "Update Notion."]) {
    const triggers = evaluateDeterministicPolicy({ task, plans: [plan()] }).map(
      (blocker) => blocker.trigger,
    );
    assert.equal(triggers.includes("dependency"), false, `${task} looked like a package update`);
  }
});

test("remote-operation meta controls do not hide an actual client-mediated effect", () => {
  for (const [task, expected] of [
    ["Use the GitHub client to delete issue #12.", "remote_write"],
    ["Use the Slack client to send a message to Slack.", "remote_write"],
    ["Run git clone after parsing the URL.", "network"],
    ["Update the Jira issue via the client.", "remote_write"],
    ["Upload the video to YouTube with the client.", "remote_write"],
    ["クライアントからNotionのページを更新してください。", "remote_write"],
  ]) {
    assert.equal(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).some(
        (blocker) => blocker.trigger === expected,
      ),
      true,
      `${task} missed ${expected}`,
    );
  }
});

test("task and plan evidence share a category-accurate decision description", () => {
  const blockers = evaluateDeterministicPolicy({
    task: "Deploy the approved build.",
    plans: [plan({ externalEffects: ["deploy the approved build"] })],
  });
  const deploy = blockers.find((blocker) => blocker.trigger === "deploy_release_publish");
  assert.ok(deploy);
  assert.match(deploy.description, /policy-relevant action/u);
  assert.doesNotMatch(deploy.description, /compatibility impacts/u);
});

test("action-bearing task and plan fields share classification without unknown", () => {
  const blockers = evaluateDeterministicPolicy({
    task: "Send a message to Slack.",
    plans: [
      plan({
        probeId: "probe_1",
        components: ["slack-adapter"],
        externalEffects: ["Send a message to Slack."],
      }),
      plan({
        probeId: "probe_2",
        components: ["notification-service"],
        intendedBehavior: ["Send a message to Slack."],
      }),
    ],
  });
  const remote = blockers.filter((blocker) => blocker.trigger === "remote_write");
  assert.equal(remote.length, 1);
  assert.deepEqual(remote[0].affectedComponents, ["notification-service", "slack-adapter"]);
  assert.deepEqual(remote[0].evidenceRefs, [
    "probe_1:externalEffects:0",
    "probe_2:intendedBehavior:0",
    "task:normalized",
  ]);
  assert.equal(
    blockers.some((blocker) => blocker.trigger === "unknown"),
    false,
  );
});

test("task provenance does not aggregate unrelated same-trigger plan effects", () => {
  const blockers = evaluateDeterministicPolicy({
    task: "Push the branch to origin.",
    plans: [
      plan({
        probeId: "probe_1",
        components: ["git"],
        externalEffects: ["git push origin main"],
      }),
      plan({
        probeId: "probe_2",
        components: ["github"],
        externalEffects: ["gh issue close 12"],
      }),
      plan({
        probeId: "probe_3",
        components: ["webhook"],
        externalEffects: ["curl -X POST https://example.invalid/hook"],
      }),
    ],
  });
  const remote = blockers.filter((blocker) => blocker.trigger === "remote_write");
  assert.equal(remote.length, 4);
  assert.equal(
    remote.every((blocker) => blocker.details.length === 1),
    true,
  );
  const taskBlocker = remote.find((blocker) => blocker.evidenceRefs.includes("task:normalized"));
  assert.ok(taskBlocker);
  assert.deepEqual(taskBlocker.affectedComponents, []);
  assert.deepEqual(taskBlocker.evidenceRefs, ["task:normalized"]);
});

test("the same normalized task and plan action merge without borrowing task components", () => {
  const blockers = evaluateDeterministicPolicy({
    task: "git push origin main.",
    plans: [
      plan({
        components: ["git"],
        externalEffects: ["git push origin main"],
      }),
    ],
  });
  const remote = blockers.filter((blocker) => blocker.trigger === "remote_write");
  assert.equal(remote.length, 1);
  assert.deepEqual(remote[0].affectedComponents, ["git"]);
  assert.deepEqual(remote[0].evidenceRefs, ["probe_1:externalEffects:0", "task:normalized"]);
});

test("negative dependency and operation language does not create a blocker", () => {
  const blockers = evaluateDeterministicPolicy({
    task: "Plan a local update without adding dependencies. Do not deploy, release, publish, or use network access.",
    plans: [
      plan({
        summary: "Plan a minimal, dependency-free update.",
        dependencyChanges: ["No new dependencies."],
      }),
      plan({
        probeId: "probe_2",
        summary: "Keep dependencies unchanged and avoid network access.",
        dependencyChanges: ["新しい依存関係は追加しない。"],
      }),
    ],
  });
  assert.deepEqual(blockers, []);
});

test("a negated first operation cannot hide a later positive operation", () => {
  for (const [task, expected] of [
    ["Do not deploy the preview, but publish the release after review.", "deploy_release_publish"],
    ["Do not deploy, then publish the release.", "deploy_release_publish"],
    ["Do not run the migrations, then push to origin.", "remote_write"],
    ["Don't install zod, then add valibot.", "dependency"],
    ["Do not implement authentication, then implement OAuth.", "authentication"],
  ]) {
    const blockers = evaluateDeterministicPolicy({ task, plans: [plan()] });
    assert.equal(
      blockers.some((blocker) => blocker.trigger === expected),
      true,
      `${task} missed ${expected}`,
    );
  }
});

test("an independent coordinated clause is not covered by an earlier negation", () => {
  const cases = [
    ["Do not deploy and you should push the branch.", "remote_write", "deploy_release_publish"],
    ["Do not deploy, and you should push the branch.", "remote_write", "deploy_release_publish"],
    ["Never delete data and please run the migration.", "migration", "destructive_data"],
    ["Do not deploy and then you should merge PR #12.", "remote_write", "deploy_release_publish"],
    ["デプロイしないで、ブランチをpushしてください。", "remote_write", "deploy_release_publish"],
    ["PR #12はマージせず、Issue #12を閉じてください。", "remote_write", null],
  ];
  for (const [task, expected, absent] of cases) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).map((blocker) => blocker.trigger),
    );
    assert.equal(triggers.has(expected), true, `${task} missed ${expected}`);
    if (absent !== null) {
      assert.equal(triggers.has(absent), false, `${task} unexpectedly matched ${absent}`);
    }
  }
});

test("test and documentation clauses cannot hide a later positive operation", () => {
  const cases = [
    ["Add tests for authentication, then implement OAuth.", "authentication"],
    ["Add tests for authentication then implement OAuth.", "authentication"],
    ["Add tests for authentication but implement OAuth.", "authentication"],
    ["Document how to deploy, then deploy to production.", "deploy_release_publish"],
    ["Document how to deploy then deploy to production.", "deploy_release_publish"],
    ["Add documentation for zod, then install zod.", "dependency"],
    ["Add tests for migration support, then run the migrations.", "migration"],
    ["Write tests for API keys then rotate the API key.", "secret"],
    ["Add tests for permissions and grant admin permissions.", "permission"],
    ["Add documentation for billing then charge a payment.", "billing"],
    ["Add tests for authentication and actually implement OAuth.", "authentication"],
    ["Add tests for authentication and fully implement OAuth.", "authentication"],
    ["Add tests for permissions and immediately grant admin permissions.", "permission"],
    ["Write tests for API keys and securely rotate the API key.", "secret"],
    ["Add documentation for billing and later charge a payment.", "billing"],
    ["Document how to deploy and actually deploy to production.", "deploy_release_publish"],
    ["Add tests for authentication, and also implement OAuth.", "authentication"],
    ["Add tests for authentication and eventually implement OAuth.", "authentication"],
    ["Add tests for permissions and urgently grant admin permissions.", "permission"],
    ["Write tests for API keys and manually rotate the API key.", "secret"],
    ["Add documentation for billing and proceed to charge a payment.", "billing"],
    ["Document how to deploy, and manually deploy to production.", "deploy_release_publish"],
    ["Document how to rotate API keys, and manually rotate the production API key.", "secret"],
    [
      "Add tests for authentication and only after all tests pass implement OAuth.",
      "authentication",
    ],
    ["Add tests for permissions and, once the tests pass, grant admin permissions.", "permission"],
    [
      "Write tests for API keys and after the review is complete rotate the production API key.",
      "secret",
    ],
    ["Add tests for password reset and then reset the administrator password.", "secret"],
    ["Add tests for promotion and then promote the build to production.", "production"],
    ["Write documentation about billing and then bill the customer.", "billing"],
    ["Add tests for records and then insert a database record.", "persistent_data"],
  ];
  for (const [task, expected] of cases) {
    assert.equal(
      evaluateDeterministicPolicy({ task, plans: [plan()] }).some(
        (blocker) => blocker.trigger === expected,
      ),
      true,
      `${task} missed ${expected}`,
    );
  }
});

test("natural high-impact task imperatives remain deterministic blockers", () => {
  const cases = [
    [
      "Commit these changes and push the branch to origin.",
      ["deploy_release_publish", "remote_write"],
    ],
    ["Create a pull request for the finished change.", ["deploy_release_publish", "remote_write"]],
    ["Release the package.", ["deploy_release_publish"]],
    ["Migrate the database.", ["migration"]],
    ["Install zod.", ["dependency"]],
    ["Call the Stripe API.", ["network"]],
    ["Run the migrations.", ["migration"]],
    ["Apply all migrations.", ["migration"]],
    ["Add zod.", ["dependency"]],
    ["Add zod as a dependency.", ["dependency"]],
    ["Install the zod package.", ["dependency"]],
    ["Remove zod.", ["dependency"]],
    ["Push to origin.", ["remote_write"]],
    ["Push it to GitHub.", ["remote_write"]],
    ["Commit it and release it.", ["deploy_release_publish"]],
    ["Enable OAuth for the application.", ["authentication"]],
    ["Grant Alice admin access.", ["permission"]],
    ["Charge the customer.", ["billing"]],
    ["Promote the build to production.", ["production"]],
    ["Revoke the production API key.", ["secret"]],
    ["Reset the administrator password.", ["secret"]],
    ["Delete the S3 bucket.", ["destructive_data"]],
    ["Create a database record.", ["persistent_data"]],
    ["Turn on OAuth login for the application.", ["authentication"]],
    ["Make Alice an administrator.", ["permission"]],
    ["Refund the customer.", ["billing"]],
    ["Roll out the service to production.", ["production"]],
    ["Scale the production service to ten replicas.", ["production"]],
    ["Regenerate the production API key.", ["secret"]],
    ["Add lodash to the project.", ["dependency"]],
    ["Upload customer data to S3.", ["network"]],
    ["Approve the pull request.", ["remote_write"]],
    ["Backfill production data.", ["persistent_data", "production"]],
  ];
  for (const [task, expected] of cases) {
    const blockers = evaluateDeterministicPolicy({ task, plans: [plan()] });
    const triggers = new Set(blockers.map((blocker) => blocker.trigger));
    for (const trigger of expected) {
      assert.equal(triggers.has(trigger), true, `${task} missed ${trigger}`);
    }
  }
});

test("negated operations, test-only wording, and compound no-change stay safe", () => {
  for (const task of [
    "Never deploy this change.",
    "Don't publish a release.",
    "Add authentication tests only.",
    "Add tests for authentication only.",
    "Add regression tests for authentication.",
    "Add documentation for authentication only.",
    "Document how to deploy the application.",
    "Document how to deploy and publish the package.",
    "Add tests for deploy and publish behavior.",
    "Write documentation about release and publish workflows.",
    "Add tests for deploy and publish failures.",
    "Add tests for deploy and publish edge cases.",
    "Write documentation about release and publish semantics.",
    "Add documentation for release and publish APIs.",
    "Document how to create and submit a pull request.",
    "Add documentation explaining how to deploy and publish the package.",
    "Add validation.",
    "Add retry support.",
    "Remove dead code.",
    "Update the documentation.",
    "Do not run the migrations or push to origin.",
    "Do not deploy and publish.",
    "Do not deploy and then publish.",
    "Never rotate the API key and deploy.",
    "Never rotate the API key and then deploy.",
    "Do not install zod and then add valibot.",
    "Do not run the migrations and afterwards push to origin.",
    "Do not deploy the application to the staging environment and then publish the release.",
    "Never rotate the API key for the staging account and then deploy.",
    `Document how to deploy after ${"verifying the build, reviewing the configuration, checking rollback instructions, and confirming the target environment, ".repeat(3)}and how to publish the package.`,
  ]) {
    assert.deepEqual(evaluateDeterministicPolicy({ task, plans: [plan()] }), [], task);
  }
  assert.deepEqual(
    evaluateDeterministicPolicy({
      plans: [
        plan({ dependencyChanges: ["Dependencies are unchanged."] }),
        plan({
          probeId: "probe_2",
          dependencyChanges: ["No new dependencies, and dependencies remain unchanged."],
        }),
      ],
    }),
    [],
  );
  assert.equal(
    evaluateDeterministicPolicy({
      plans: [plan({ dependencyChanges: ["No new dependencies, but install zod."] })],
    }).some((blocker) => blocker.trigger === "dependency"),
    true,
  );
});

test("safe equivalent plans create no deterministic blocker", () => {
  const safe = plan();
  const blockers = evaluateDeterministicPolicy({
    plans: [safe, { ...safe, probeId: "probe_2" }, { ...safe, probeId: "probe_3" }],
  });
  assert.deepEqual(blockers, []);
  assert.equal(createDecisionRound(blockers).executionAllowed, true);
  assert.equal(
    createDecisionRound(evaluateDeterministicPolicy({ plans: [] })).executionAllowed,
    false,
  );

  const explicitNoImpact = evaluateDeterministicPolicy({
    plans: [
      plan({ compatibilityImpacts: ["No compatibility impact."] }),
      plan({
        probeId: "probe_2",
        compatibilityImpacts: ["通常の入力では互換性を維持する。"],
      }),
    ],
  });
  assert.deepEqual(explicitNoImpact, []);

  const compoundImpact = evaluateDeterministicPolicy({
    plans: [
      plan({
        compatibilityImpacts: ["空入力の出力は変わるが、通常入力の互換性を維持する。"],
      }),
    ],
  });
  assert.equal(compoundImpact.length, 1);
  assert.equal(compoundImpact[0].trigger, "compatibility");
});

test("structured no-change fields stay safe while public endpoint removal fails closed", () => {
  const noChanges = [
    { dataChanges: ["No data changes."] },
    { dataChanges: ["Persistent data remains unchanged."] },
    { dataChanges: ["データ変更なし。"] },
    { permissionChanges: ["No permission changes."] },
    { permissionChanges: ["Permissions remain unchanged."] },
    { permissionChanges: ["権限変更なし。"] },
    { externalEffects: ["No external effects."] },
    { externalEffects: ["No remote writes or network access."] },
    { externalEffects: ["外部影響なし。"] },
  ];
  for (const [index, override] of noChanges.entries()) {
    assert.deepEqual(
      evaluateDeterministicPolicy({
        plans: [plan({ probeId: `probe_${String(index)}`, ...override })],
      }),
      [],
      JSON.stringify(override),
    );
  }

  const blockers = evaluateDeterministicPolicy({
    plans: [plan({ publicApiChanges: ["Remove the public endpoint /v1/users."] })],
  });
  assert.equal(
    blockers.some((blocker) => blocker.trigger === "breaking_api"),
    true,
  );
});

test("AC-004 spec fixture: dependency addition requires an explicit decision", () => {
  const blockers = evaluateDeterministicPolicy({
    plans: [
      plan({
        summary: "Upgrade the existing validation dependency.",
        dependencyChanges: ["replace zod with valibot"],
      }),
    ],
  });
  assert.ok(blockers.some((blocker) => blocker.trigger === "dependency"));
  assert.equal(createDecisionRound(blockers).executionAllowed, false);
});

test("AC-004 spec fixture: network or deploy command cannot auto-approve", () => {
  const blockers = evaluateDeterministicPolicy({
    plans: [
      plan({
        commands: ["curl https://example.invalid", "vercel deploy --prod"],
        externalEffects: ["deploy to production"],
      }),
    ],
  });
  const triggers = new Set(blockers.map((blocker) => blocker.trigger));
  assert.equal(triggers.has("network"), true);
  assert.equal(triggers.has("deploy_release_publish"), true);
  assert.equal(createDecisionRound(blockers).executionAllowed, false);
});

test("planned commands use shell-free classification instead of prose matching", () => {
  const risky = [
    ["cat .env", ["secret"]],
    ["sed -n '1p' .npmrc", ["secret"]],
    ["rg TOKEN .env", ["secret"]],
    ["git show HEAD:.env", ["secret"]],
    ["git show HEAD:.git/config", ["secret"]],
    ["cat ../outside", ["scope_expansion", "unknown"]],
    ["cat /etc/hosts", ["scope_expansion", "unknown"]],
    ["sed -i 's/a/b/' README.md", ["unknown"]],
    ["rg --pre 'cat README.md' TODO .", ["unknown"]],
    ["git diff --output=../diff.txt", ["unknown"]],
    ["npm run build -- --outDir ../escape", ["scope_expansion", "unknown"]],
    ["cat README.md > ../outside", ["unknown"]],
    ["npm ci", ["dependency", "network"]],
    ["git send-pack origin main", ["network", "remote_write"]],
  ];
  for (const [command, expected] of risky) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ plans: [plan({ commands: [command] })] }).map(
        (blocker) => blocker.trigger,
      ),
    );
    for (const trigger of expected) {
      assert.equal(triggers.has(trigger), true, `${command} missed ${trigger}`);
    }
  }

  for (const command of [
    "rg ssh",
    "rg 'git push'",
    "cat docs/deploy",
    "cat docs/release-notes.md",
    "git show README.md",
    "npm run verify:release",
    "npm run check:release",
    "npm run check:submission",
  ]) {
    assert.deepEqual(
      evaluateDeterministicPolicy({ plans: [plan({ commands: [command] })] }),
      [],
      command,
    );
  }
});

test("planned command path auditing distinguishes operands from query and filter text", () => {
  const risky = [
    ["npm test -- --outputFile=/tmp/out", ["scope_expansion", "unknown"]],
    ["curl --config .env https://example.invalid", ["network", "secret"]],
    ["pytest /tmp", ["scope_expansion", "unknown"]],
    ["pytest ../tests", ["scope_expansion", "unknown"]],
    ["pytest --basetemp=/tmp tests", ["scope_expansion", "unknown"]],
    ["jest --config /tmp/jest.config.js", ["scope_expansion", "unknown"]],
    ["vitest --config ../vitest.config.ts", ["scope_expansion", "unknown"]],
    ["eslint --config /tmp/eslint.config.mjs src", ["scope_expansion", "unknown"]],
    ["ruff check /etc", ["scope_expansion", "unknown"]],
    ["tsc --project /tmp/tsconfig.json", ["scope_expansion", "unknown"]],
    ["npm run test:unit -- --config ../test.config.js", ["scope_expansion", "unknown"]],
    ["pnpm test -- --config /tmp/test.config.js", ["scope_expansion", "unknown"]],
    ["head .env", ["secret"]],
    ["tail .npmrc", ["secret"]],
    ["cut -d : -f 1 .env", ["secret"]],
    ["jq . .env", ["secret"]],
    ["sort .npmrc", ["secret"]],
    ["uniq .env", ["secret"]],
    ["wc .npmrc", ["secret"]],
    ["head /etc/passwd", ["scope_expansion", "unknown"]],
    ["tree /Users", ["scope_expansion", "unknown"]],
    ["find / -name .env", ["scope_expansion", "unknown"]],
  ];
  for (const [command, expected] of risky) {
    const triggers = new Set(
      evaluateDeterministicPolicy({ plans: [plan({ commands: [command] })] }).map(
        (blocker) => blocker.trigger,
      ),
    );
    for (const trigger of expected) {
      assert.equal(triggers.has(trigger), true, `${command} missed ${trigger}`);
    }
  }

  for (const command of [
    "head README.md",
    "tail README.md",
    "cut -d : -f 1 README.md",
    "jq '.env' package.json",
    "sort README.md",
    "uniq README.md",
    "wc README.md",
    "tree src",
    "find . -name .env",
    "rg .env",
    "rg 'git push' src",
    "pytest tests/unit",
    "jest --config config/jest.config.js",
    "vitest --config config/vitest.config.ts",
    "eslint --config config/eslint.config.mjs src",
    "ruff check src",
    "tsc --project tsconfig.json",
    "npm run test:unit -- --config config/test.config.js",
    "pnpm test -- --config config/test.config.js",
  ]) {
    assert.deepEqual(
      evaluateDeterministicPolicy({ plans: [plan({ commands: [command] })] }),
      [],
      command,
    );
  }
});

test("planned-command safe prefixes reject shell composition and redirection", () => {
  for (const command of [
    "npm test && rm -rf .",
    "cat README.md > /tmp/copy",
    "rg TODO . | tee /tmp/result",
    "git status; true",
    "sed -n '1p' README.md\nwhoami",
    "npm run build $(whoami)",
    'rg "$(whoami)" src',
    'rg "`whoami`" src',
    'cat "$HOME/.ssh/id_rsa"',
    'rg "$PATTERN" .',
    "cat ${HOME}/.ssh/id_rsa",
    "cat ~/.ssh/id_rsa",
    "cat *.md",
    "cat src/{a,b}.ts",
    "rg TODO [Ss]rc",
    "pytest tests &",
  ]) {
    const blockers = evaluateDeterministicPolicy({
      plans: [plan({ commands: [command] })],
    });
    assert.equal(
      blockers.some((blocker) => blocker.trigger === "unknown"),
      true,
      `${command} was accepted by the safe-command prefix`,
    );
  }

  const remoteCompound = evaluateDeterministicPolicy({
    plans: [plan({ commands: ["git status; git push origin main"] })],
  });
  assert.equal(
    remoteCompound.some((blocker) => blocker.trigger === "remote_write"),
    true,
  );

  for (const command of [
    "npm test",
    "npm run check:security",
    "pnpm typecheck",
    "pytest tests/unit",
    "ruff check .",
    "tsc --noEmit",
    "make check",
    "git status --short",
    'rg "foo|bar" src',
    'rg "foo$" src',
    "rg '$PATTERN' .",
    "rg '*.md' .",
    "cat 'src/{a,b}.ts'",
    "rg 'a>b' src",
    "rg '$(literal)' src",
    "cat README.md",
    "sed -n '1,20p' README.md",
  ]) {
    assert.deepEqual(
      evaluateDeterministicPolicy({ plans: [plan({ commands: [command] })] }),
      [],
      command,
    );
  }
});

test("AC-006: decision rounds show three blockers, a remaining count, and stay blocked", () => {
  const blockers = evaluateDeterministicPolicy({
    plans: [
      plan({
        dataChanges: ["delete persistent records", "apply migration"],
        dependencyChanges: ["add dependency"],
        externalEffects: ["network write", "publish release"],
      }),
    ],
  });
  assert.ok(blockers.length >= 5);
  const firstRound = createDecisionRound(blockers);
  assert.equal(firstRound.blockers.length, 3);
  assert.equal(firstRound.remainingCount, blockers.length - 3);
  assert.equal(firstRound.unresolvedCount, blockers.length);
  assert.equal(firstRound.executionAllowed, false);

  const allButOne = new Set(blockers.slice(0, -1).map((blocker) => blocker.blockerId));
  const finalRound = createDecisionRound(blockers, allButOne);
  assert.equal(finalRound.blockers.length, 1);
  assert.equal(finalRound.executionAllowed, false);
  assert.equal(
    createDecisionRound(blockers, new Set(blockers.map((blocker) => blocker.blockerId)))
      .executionAllowed,
    true,
  );

  const compatibility = evaluateDeterministicPolicy({
    plans: [
      plan({
        compatibilityImpacts: [
          "Whitespace around a name is removed.",
          "An empty name now uses the stranger fallback.",
        ],
      }),
      plan({
        probeId: "probe_2",
        compatibilityImpacts: [
          "Existing callers no longer retain surrounding spaces.",
          "Blank input returns Hello, stranger!.",
        ],
      }),
    ],
  });
  assert.equal(compatibility.length, 1);
  assert.equal(compatibility[0].trigger, "compatibility");
  assert.equal(compatibility[0].details.length, 4);
  assert.equal(compatibility[0].evidenceRefs.length, 4);
  assert.match(compatibility[0].description, /all-or-none choice/u);
});

test("repository-relative POSIX path matching fails closed", () => {
  assert.deepEqual(normalizeRepositoryRelativePath("src//./feature.ts"), {
    ok: true,
    path: "src/feature.ts",
  });
  assert.equal(matchesRepositoryPath("src/nested/feature.ts", "src/**"), true);
  assert.equal(matchesRepositoryPath(".env", "**/.env"), true);

  const contract = { allowedPaths: ["src/**", ".env"], protectedPaths: ["src/protected/**"] };
  assert.equal(
    matchPathRequest(
      { requestedPath: "src/feature.ts", resolvedPath: "src/feature.ts", caseAmbiguous: false },
      contract,
    ).outcome,
    "allow",
  );
  const rejected = [
    { requestedPath: "/tmp/feature.ts", resolvedPath: "src/feature.ts", caseAmbiguous: false },
    { requestedPath: "../feature.ts", resolvedPath: "src/feature.ts", caseAmbiguous: false },
    { requestedPath: "src/Feature.ts", resolvedPath: "src/Feature.ts", caseAmbiguous: true },
    { requestedPath: "src/link", resolvedPath: "../outside", caseAmbiguous: false },
    { requestedPath: "src/link", resolvedPath: null, caseAmbiguous: false },
    {
      requestedPath: "src/protected/file.ts",
      resolvedPath: "src/protected/file.ts",
      caseAmbiguous: false,
    },
    { requestedPath: ".env", resolvedPath: ".env", caseAmbiguous: false },
    { requestedPath: "src/link", resolvedPath: ".ssh/id_ed25519", caseAmbiguous: false },
    { requestedPath: "other/file.ts", resolvedPath: "other/file.ts", caseAmbiguous: false },
  ];
  for (const request of rejected) {
    assert.equal(matchPathRequest(request, contract).outcome, "deny");
  }
});

test("unknown, raw, denied, or partially approved compound commands are denied", () => {
  const allowReadAndTest = {
    allowedCommandClasses: ["static_read", "test"],
    deniedCommandClasses: ["network"],
  };
  assert.equal(
    matchCommandRequest(
      { source: "structured", actions: [{ program: "rg", args: ["needle", "src"] }] },
      allowReadAndTest,
    ).outcome,
    "allow",
  );
  assert.equal(
    matchCommandRequest(
      {
        source: "structured",
        actions: [{ program: "sed", args: ["-n", "1,20p", "src/file.ts"] }],
      },
      allowReadAndTest,
    ).outcome,
    "allow",
  );
  const rejected = [
    { source: "raw", actions: [{ program: "rg", args: ["needle"] }] },
    { source: "structured", actions: [{ program: "mystery-tool", args: [] }] },
    { source: "structured", actions: [{ program: "sh", args: ["-c", "npm test"] }] },
    { source: "structured", actions: [{ program: "./rg", args: ["needle", "src"] }] },
    { source: "structured", actions: [{ program: "rg", args: ["--pre=cat", "needle"] }] },
    {
      source: "structured",
      actions: [{ program: "find", args: ["src", "-exec", "touch", "file", "+"] }],
    },
    {
      source: "structured",
      actions: [
        { program: "rg", args: ["needle", "src"] },
        { program: "curl", args: ["https://example.com"] },
      ],
    },
  ];
  for (const request of rejected) {
    assert.equal(matchCommandRequest(request, allowReadAndTest).outcome, "deny");
  }
  for (const action of [
    { program: "sed", args: ["-i", "s/a/b/", "src/file.ts"] },
    { program: "find", args: ["src", "-delete"] },
    { program: "sort", args: ["input", "-o", "output"] },
  ]) {
    assert.equal(
      matchCommandRequest({ source: "structured", actions: [action] }, allowReadAndTest).outcome,
      "deny",
    );
  }
  const readOnlyNetwork = {
    allowedCommandClasses: ["network"],
    deniedCommandClasses: ["remote_write"],
  };
  for (const action of [
    { program: "gh", args: ["api", "repos/example", "-f", "state=closed"] },
    { program: "gh", args: ["api", "repos/example", "-XPOST"] },
    { program: "curl", args: ["-X", "POST", "https://example.com"] },
    { program: "wget", args: ["--post-data=value", "https://example.com"] },
    { program: "ssh", args: ["example.com", "touch", "file"] },
  ]) {
    assert.equal(
      matchCommandRequest({ source: "structured", actions: [action] }, readOnlyNetwork).outcome,
      "deny",
    );
  }
});

test("AC-011: network, named external actions, and permission expansion use exact allowlists", () => {
  const networkPolicy = {
    mode: "allowlist",
    hosts: ["api.openai.com"],
    actions: ["read"],
  };
  assert.equal(
    matchNetworkRequest({ host: "API.OPENAI.COM.", action: "read" }, networkPolicy).outcome,
    "allow",
  );
  for (const request of [
    { host: "api.openai.com", action: "write" },
    { host: "example.com", action: "read" },
    { host: "*.openai.com", action: "read" },
    { host: "api.openai.com", action: "unknown" },
  ]) {
    assert.equal(matchNetworkRequest(request, networkPolicy).outcome, "deny");
  }
  assert.equal(
    matchNetworkRequest(
      { host: "api.openai.com", action: "read" },
      { mode: "allowlist", hosts: ["*.openai.com"], actions: ["read"] },
    ).outcome,
    "deny",
  );
  assert.equal(
    matchNamedAction("github:issue:read", {
      mode: "allowlist",
      allowed: ["github:issue:read"],
    }).outcome,
    "allow",
  );
  assert.equal(
    matchNamedAction("github:issue:write", {
      mode: "allowlist",
      allowed: ["github:issue:read"],
    }).outcome,
    "deny",
  );
  assert.equal(denyPermissionExpansion().outcome, "deny");
});

test("AC-014: secret fixture values and raw reasoning never pass log or export gates", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../../fixtures/security/secret-redaction.json", import.meta.url), "utf8"),
  );
  const log = [
    `secret=${fixture.knownSecret}`,
    `authorization=${fixture.authorization}`,
    `path=${fixture.secretPath}`,
    fixture.privateKey,
    ["-----BEGIN", "PRIVATE KEY-----\nsynthetic-material\n-----END", "PRIVATE KEY-----"].join(" "),
  ].join("\n");
  const knownSecrets = [fixture.knownSecret, fixture.privateKey];
  const redacted = redactText(log, { knownSecrets });
  assert.ok(redacted.redactionCount >= 5);
  assert.equal(containsSecretLikeText(redacted.text, { knownSecrets }), false);
  for (const value of Object.values(fixture)) assert.equal(redacted.text.includes(value), false);

  const policyBlockers = evaluateDeterministicPolicy({
    plans: [plan({ unknowns: [`Unclassified value ${fixture.knownSecret}`] })],
    knownSecrets,
  });
  assert.equal(
    policyBlockers.some((blocker) => blocker.description.includes(fixture.knownSecret)),
    false,
  );

  const exported = sanitizeForExport(
    {
      message: log,
      rawReasoning: `hidden ${fixture.knownSecret}`,
      processEnv: { OPENAI_API_KEY: fixture.knownSecret },
      nested: { accessToken: fixture.knownSecret },
    },
    { knownSecrets },
  );
  assert.equal(exported.allowed, true);
  if (!exported.allowed) return;
  assert.ok(exported.redactionCount >= 7);
  for (const value of Object.values(fixture)) assert.equal(exported.json.includes(value), false);
  assert.equal(exported.json.includes("hidden"), false);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.deepEqual(sanitizeForExport(cyclic), {
    allowed: false,
    reason: "unsupported_value",
  });
});

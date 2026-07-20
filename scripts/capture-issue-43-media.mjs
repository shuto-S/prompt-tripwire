#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { startReviewServer } from "../apps/ui/dist/index.js";
import { createReviewFixture } from "../tests/helpers/review-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "docs", "assets", "demo");
const narrationPath = join(root, "docs", "demo", "NARRATION_issue-43-source-preview.md");
const captionsPath = join(root, "docs", "demo", "prompt-tripwire-issue-43-source-preview.en.srt");
const scratch = await mkdtemp(join(tmpdir(), "prompt-tripwire-issue-43-media-"));

function greetingDecision(value) {
  return {
    ...value,
    category: "compatibility",
    question: "Should all disclosed compatibility changes be allowed?",
    reason:
      "The same-input probes disagree about whether whitespace-only and surrounding-whitespace callers should receive the requested behavior.",
    impact: "medium",
    options: [
      {
        id: `${value.decisionId}_deny`,
        label: "Do not allow",
        description: "Keep the compatibility impacts outside the execution contract.",
        effects: ["The implementation remains blocked"],
        supportedByProbeIds: ["probe_1"],
        evidenceRefs: ["evidence_probe_1"],
      },
      {
        id: `${value.decisionId}_allow`,
        label: "Allow local implementation",
        description:
          "Include all disclosed compatibility impacts while preserving every other runtime boundary.",
        effects: [
          "Whitespace-only names use the stranger fallback",
          "Names with surrounding whitespace are trimmed",
          "Dependencies and external actions remain blocked",
        ],
        supportedByProbeIds: ["probe_2", "probe_3"],
        evidenceRefs: ["evidence_probe_2", "evidence_probe_3"],
      },
    ],
    deterministicTriggers: ["compatibility"],
    evidenceRefs: ["evidence_probe_1", "evidence_probe_2", "evidence_probe_3"],
  };
}

function greetingPlan(value, index) {
  return {
    ...value,
    summary: `Validated greeting plan ${String(index + 1)}`,
    assumptions: ["name is always a string"],
    intendedBehavior: [
      "Trim surrounding whitespace before greeting",
      "Return Hello, stranger! when the trimmed name is empty",
    ],
    filesToRead: ["src/greeting.js", "test/greeting.test.js"],
    filesToChange: ["src/greeting.js", "test/greeting.test.js"],
    components: ["greeting"],
    dataChanges: [],
    publicApiChanges: [],
    commands: ["npm test"],
    compatibilityImpacts:
      index === 0
        ? []
        : [
            "Whitespace-only names use the stranger fallback",
            "Names with surrounding whitespace are trimmed",
          ],
    reversibility: "reversible",
    verificationSteps: ["Run npm test"],
    repositoryEvidence: [
      {
        id: `evidence_${value.probeId}`,
        path: index === 0 ? "src/greeting.js" : "test/greeting.test.js",
        startLine: 1,
        endLine: 12,
        description: "Current greeting behavior and its focused tests.",
      },
    ],
  };
}

function comparisonDivergence(decision) {
  return {
    subject: {
      id: `subject_${decision.decisionId}`,
      summary: "Greeting compatibility behavior",
      affectedBehaviors: ["greeting normalization and empty-name fallback"],
      affectedFiles: ["src/greeting.js", "test/greeting.test.js"],
      affectedData: [],
      affectedApis: [],
      affectedCommands: ["npm test"],
      affectedExternalSystems: [],
      evidenceRefs: decision.evidenceRefs,
    },
    alternatives: decision.options.map((option, index) => ({
      id: `alternative_${String(index + 1)}`,
      label: option.label,
      description: option.description,
      effects: option.effects,
      supportedByProbeIds: option.supportedByProbeIds,
      evidenceRefs: option.evidenceRefs,
      reversibility: "reversible",
    })),
    suggestedQuestion: decision.question,
    recommendation: null,
  };
}

const japanesePresentation = {
  task: "greeting(name)で前後の空白を除去し、空ならHello, stranger!を返す",
  decisions: [
    {
      decisionId: "decision_1",
      question: "開示された互換性への影響をすべて許可しますか？",
      reason:
        "同一入力のプローブ間で、空白だけの名前と前後に空白がある名前の互換性を変更するか一致していません。",
      options: [
        {
          optionId: "decision_1_deny",
          label: "許可しない",
          description: "互換性への影響を実行契約の対象外にします。",
          effects: ["実装は引き続きブロックされます"],
        },
        {
          optionId: "decision_1_allow",
          label: "ローカル実装を許可",
          description: "他の境界を維持したまま、開示済みの互換性への影響を契約に含めます。",
          effects: [
            "空白だけの名前はstrangerフォールバックを使用します",
            "前後に空白がある名前はトリムされます",
            "依存関係と外部操作は引き続き禁止されます",
          ],
        },
      ],
    },
  ],
};

async function createIssueFixture(runId) {
  return createReviewFixture({
    runId,
    presentationStatus: "available",
    presentationContent: japanesePresentation,
    repositoryPath: "/prompt-tripwire-judge-fixture",
    task: "Update src/greeting.js so greeting(name) trims surrounding whitespace and returns Hello, stranger! when the trimmed name is empty. Update focused tests. Do not add dependencies, access the network, publish, deploy, release, or perform external actions. Verify with npm test.",
    transformDecision: greetingDecision,
    transformPlan: greetingPlan,
    transformCandidate: (candidate, decisions) => ({
      ...candidate,
      divergences: [comparisonDivergence(decisions[0])],
    }),
  });
}

async function captureScreenshots(browser) {
  const fixture = await createIssueFixture("run_issue_43_screenshots");
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
    closeGraceMs: 5_000,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(server.url);
    await page.getByText("3 of 3 independent planning probes are valid", { exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "decision-origin-issue-43-source-preview-en.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "日本語" }).click();
    await page.getByText("3件中3件の独立計画プローブが有効", { exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "decision-origin-issue-43-source-preview-ja.png"),
      fullPage: true,
    });

    const mobileContext = await browser.newContext({
      locale: "ja-JP",
      viewport: { width: 390, height: 844 },
    });
    const mobile = await mobileContext.newPage();
    try {
      await mobile.goto(server.url);
      await mobile.getByText("3件中3件の独立計画プローブが有効", { exact: true }).waitFor();
      await mobile.screenshot({
        path: join(output, "decision-origin-issue-43-source-preview-mobile-ja.png"),
        fullPage: true,
      });
    } finally {
      await mobileContext.close();
    }

    await page.getByRole("button", { name: "English" }).click();
    await page.getByRole("radio", { name: /Allow local implementation/u }).check();
    await page.getByRole("button", { name: "Record decision" }).click();
    await page.getByRole("heading", { name: "What Codex may change" }).waitFor();
    await page.screenshot({
      path: join(output, "contract-preview-issue-43-source-preview-en.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
    await server.close();
    await fixture.close();
  }
}

async function captureVideo(browser) {
  const fixture = await createIssueFixture("run_issue_43_video");
  const server = await startReviewServer({
    controller: fixture.controller,
    runId: fixture.run.runId,
    closeGraceMs: 5_000,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: scratch, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const video = page.video();
  try {
    await page.goto(server.url);
    await page.getByText("3 of 3 independent planning probes are valid", { exact: true }).waitFor();
    await page.waitForTimeout(4_000);
    await page
      .getByRole("heading", { name: "Decisions requiring review" })
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(6_000);
    await page.getByText("Observed divergence and deterministic policy", { exact: true }).hover();
    await page.waitForTimeout(5_000);
    await page.getByRole("radio", { name: /Allow local implementation/u }).check();
    await page.waitForTimeout(3_000);
    await page.getByRole("button", { name: "Record decision" }).click();
    await page.getByRole("heading", { name: "What Codex may change" }).waitFor();
    await page.getByRole("heading", { name: "What Codex may change" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(8_000);
    await page.getByRole("heading", { name: "What remains blocked" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(8_000);
    await page
      .getByRole("heading", { name: "Approve the bounded execution" })
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(18_000);
  } finally {
    await page.close();
    await context.close();
    await server.close();
    await fixture.close();
  }
  assert.notEqual(video, null);
  return video.path();
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  await captureScreenshots(browser);
  const rawVideo = await captureVideo(browser);
  const rawCopy = join(scratch, "source-preview.webm");
  await copyFile(rawVideo, rawCopy);

  const narration = (await readFile(narrationPath, "utf8"))
    .replace(/^#.*$/gmu, "")
    .replace(/\n+/gu, " ")
    .trim();
  const audio = join(scratch, "narration.aiff");
  execFileSync("/usr/bin/say", ["-v", "Samantha", "-r", "165", "-o", audio, narration]);

  const finalVideo = join(output, "prompt-tripwire-issue-43-source-preview.mp4");
  execFileSync("/opt/homebrew/bin/ffmpeg", [
    "-y",
    "-i",
    rawCopy,
    "-i",
    audio,
    "-i",
    captionsPath,
    "-filter_complex",
    "[0:v:0]trim=duration=33,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=19[video]",
    "-map",
    "[video]",
    "-map",
    "1:a:0",
    "-map",
    "2:0",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-g",
    "25",
    "-keyint_min",
    "25",
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-af",
    "apad",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-c:s",
    "mov_text",
    "-metadata:s:s:0",
    "language=eng",
    "-disposition:s:0",
    "default",
    "-shortest",
    finalVideo,
  ]);

  execFileSync("/opt/homebrew/bin/ffmpeg", [
    "-y",
    "-ss",
    "12",
    "-i",
    finalVideo,
    "-frames:v",
    "1",
    "-update",
    "1",
    join(output, "prompt-tripwire-issue-43-source-preview-thumbnail.png"),
  ]);
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

process.stdout.write(`Issue #43 source-preview media written to ${output}\n`);

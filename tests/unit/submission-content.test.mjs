import assert from "node:assert/strict";
import test from "node:test";

import {
  demoDistributionDisclosure,
  submissionMetadataViolations,
} from "../../scripts/submission-metadata.mjs";

const metadata = {
  demoCaptureVersion: "0.1.2",
  distributionVersion: "0.1.12",
};

test("canonical demo and judge distribution disclosure passes", () => {
  const content = demoDistributionDisclosure(metadata);
  assert.deepEqual(submissionMetadataViolations({ ...metadata, content, path: "judge.md" }), []);
});

test("historical version cannot be described as the current judge distribution", () => {
  const content = `${demoDistributionDisclosure(metadata)}\nThe current judge distribution is v0.1.2.`;
  assert.deepEqual(submissionMetadataViolations({ ...metadata, content, path: "judge.md" }), [
    "judge.md: historical version described as current judge distribution",
  ]);
});

test("pending URL cannot be described as public evidence", () => {
  const content = `${demoDistributionDisclosure(metadata)}\nPublic YouTube URL: <PENDING>`;
  assert.deepEqual(submissionMetadataViolations({ ...metadata, content, path: "judge.md" }), [
    "judge.md: pending URL described as public evidence",
  ]);
});

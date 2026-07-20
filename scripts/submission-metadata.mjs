export function demoDistributionDisclosure({ demoCaptureVersion, distributionVersion }) {
  return `The demo is a v${demoCaptureVersion} capture. The judge distribution is v${distributionVersion}. Releases v0.1.3 through v${distributionVersion} improved compatibility, safety, localization, and presentation precision without changing the video's human-approval or contract boundary.`;
}

export function submissionMetadataViolations({
  content,
  demoCaptureVersion,
  distributionVersion,
  path,
}) {
  const violations = [];
  const disclosure = demoDistributionDisclosure({ demoCaptureVersion, distributionVersion });

  if (!content.includes(disclosure)) {
    violations.push(`${path}: missing canonical demo/distribution disclosure`);
  }

  const currentDistributionPattern =
    /(?:current|final) judge distribution is v([0-9]+\.[0-9]+\.[0-9]+)/giu;
  for (const match of content.matchAll(currentDistributionPattern)) {
    if (match[1] !== distributionVersion) {
      violations.push(`${path}: historical version described as current judge distribution`);
    }
  }

  if (/public (?:YouTube|demo) (?:URL|evidence):[^\r\n]*<PENDING/iu.test(content)) {
    violations.push(`${path}: pending URL described as public evidence`);
  }

  return violations;
}

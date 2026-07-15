import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { containsSecretLikeText, redactText, sanitizeForExport } from "@prompt-tripwire/policy";

import { PersistenceError } from "./errors.js";

export interface ArtifactWrite {
  readonly contentHash: string;
  readonly relativePath: string;
  readonly byteCount: number;
}

function assertContained(root: string, path: string): void {
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith("..") || fromRoot.startsWith("/")) {
    throw new PersistenceError("ARTIFACT_INTEGRITY_ERROR", "artifact path escaped private root");
  }
}

function contentHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export class PrivateArtifactStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
  }

  putJson(value: unknown): ArtifactWrite {
    const sanitized = sanitizeForExport(value);
    if (!sanitized.allowed) {
      throw new PersistenceError("REDACTION_FAILED", sanitized.reason);
    }
    return this.putSanitized(`${sanitized.json}\n`, "json");
  }

  putMarkdown(value: string): ArtifactWrite {
    const redacted = redactText(value);
    if (containsSecretLikeText(redacted.text)) {
      throw new PersistenceError("REDACTION_FAILED", "markdown redaction verification failed");
    }
    return this.putSanitized(redacted.text, "md");
  }

  read(write: Pick<ArtifactWrite, "contentHash" | "relativePath" | "byteCount">): Buffer {
    const path = resolve(this.root, write.relativePath);
    assertContained(this.root, path);
    const content = readFileSync(path);
    if (content.byteLength !== write.byteCount || contentHash(content) !== write.contentHash) {
      throw new PersistenceError("ARTIFACT_INTEGRITY_ERROR", "artifact content hash mismatch");
    }
    return content;
  }

  remove(relativePath: string): void {
    const path = resolve(this.root, relativePath);
    assertContained(this.root, path);
    rmSync(path, { force: true });
  }

  private putSanitized(content: string, extension: "json" | "md"): ArtifactWrite {
    const hash = contentHash(content);
    const relativePath = join("sha256", hash.slice(0, 2), `${hash}.${extension}`);
    const path = resolve(this.root, relativePath);
    assertContained(this.root, path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);

    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8");
      if (contentHash(existing) !== hash) {
        throw new PersistenceError("ARTIFACT_INTEGRITY_ERROR", "artifact collision detected");
      }
      chmodSync(path, 0o600);
      return { contentHash: hash, relativePath, byteCount: Buffer.byteLength(content) };
    }

    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      renameSync(temporary, path);
      chmodSync(path, 0o600);
    } finally {
      rmSync(temporary, { force: true });
    }
    return { contentHash: hash, relativePath, byteCount: Buffer.byteLength(content) };
  }
}

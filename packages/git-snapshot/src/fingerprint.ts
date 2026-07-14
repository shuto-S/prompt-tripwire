import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { GitSnapshotError } from "./errors.js";

export interface CheckoutFingerprint {
  readonly sha256: string;
  readonly entryCount: number;
  readonly byteCount: number;
}

function posixRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function updateField(hash: ReturnType<typeof createHash>, value: string | Uint8Array): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  hash.update(String(bytes.byteLength), "utf8");
  hash.update(":", "utf8");
  hash.update(bytes);
  hash.update("\0", "utf8");
}

async function hashFile(hash: ReturnType<typeof createHash>, path: string): Promise<number> {
  let byteCount = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      byteCount += bytes.byteLength;
      hash.update(bytes);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  hash.update("\0", "utf8");
  return byteCount;
}

export async function fingerprintCheckout(root: string): Promise<CheckoutFingerprint> {
  const hash = createHash("sha256");
  let entryCount = 0;
  let byteCount = 0;

  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    );
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      const relativePath = posixRelative(root, path);
      const metadata = await lstat(path);
      entryCount += 1;
      updateField(hash, relativePath);
      updateField(hash, String(metadata.mode & 0o7777));
      if (metadata.isDirectory()) {
        updateField(hash, "directory");
        await visit(path);
      } else if (metadata.isSymbolicLink()) {
        updateField(hash, "symlink");
        const target = await readlink(path, "utf8");
        updateField(hash, target);
        byteCount += Buffer.byteLength(target, "utf8");
      } else if (metadata.isFile()) {
        updateField(hash, "file");
        updateField(hash, String(metadata.size));
        byteCount += await hashFile(hash, path);
      } else {
        throw new GitSnapshotError(
          "UNSUPPORTED_CHECKOUT_ENTRY",
          "fingerprint",
          "The checkout contains an unsupported filesystem entry.",
        );
      }
    }
  }

  await visit(root);
  return { sha256: hash.digest("hex"), entryCount, byteCount };
}

export function fingerprintsMatch(
  before: CheckoutFingerprint,
  after: CheckoutFingerprint,
): boolean {
  return (
    before.sha256 === after.sha256 &&
    before.entryCount === after.entryCount &&
    before.byteCount === after.byteCount
  );
}

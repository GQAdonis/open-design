import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertFreshToolBuild, writeToolBuildMetadata } from "./tool-build-metadata.mjs";

async function createToolFixture(name) {
  const root = await mkdtemp(join(tmpdir(), `open-design-${name}-`));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ name, private: true }, null, 2), "utf8");
  await writeFile(join(root, "esbuild.config.mjs"), "export default {};\n", "utf8");
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext" } }, null, 2), "utf8");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "index.mjs"), "export {};\n", "utf8");
  return root;
}

test("writeToolBuildMetadata writes the expected build hash shape", async () => {
  const toolRoot = await createToolFixture("tools-dev");
  try {
    const { hash, metadataPath } = await writeToolBuildMetadata("tools-dev", toolRoot);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.deepEqual(metadata, { build: { hash } });
    await assert.doesNotReject(assertFreshToolBuild("tools-dev", toolRoot));
  } finally {
    await rm(toolRoot, { force: true, recursive: true });
  }
});

test("assertFreshToolBuild fails when source hash drifts from dist metadata", async () => {
  const toolRoot = await createToolFixture("tools-serve");
  try {
    await writeToolBuildMetadata("tools-serve", toolRoot);
    await writeFile(join(toolRoot, "src", "index.ts"), "export const value = 2;\n", "utf8");
    await assert.rejects(
      assertFreshToolBuild("tools-serve", toolRoot),
      /build metadata hash mismatch/,
    );
  } finally {
    await rm(toolRoot, { force: true, recursive: true });
  }
});

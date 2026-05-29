#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_BUILD_POLICIES = {
  "tools-dev": {
    buildCommand: "pnpm --filter @open-design/tools-dev build",
    distEntries: ["dist/index.mjs"],
    inputs: ["src", "package.json", "esbuild.config.mjs", "tsconfig.json"],
    packageName: "@open-design/tools-dev",
  },
  "tools-pack": {
    buildCommand: "pnpm --filter @open-design/tools-pack build",
    distEntries: ["dist/index.mjs"],
    inputs: ["src", "resources", "package.json", "esbuild.config.mjs", "tsconfig.json"],
    packageName: "@open-design/tools-pack",
  },
  "tools-serve": {
    buildCommand: "pnpm --filter @open-design/tools-serve build",
    distEntries: ["dist/index.mjs"],
    inputs: ["src", "package.json", "esbuild.config.mjs", "tsconfig.json"],
    packageName: "@open-design/tools-serve",
  },
};

function resolveToolBuildPolicy(toolName) {
  const policy = TOOL_BUILD_POLICIES[toolName];
  if (policy == null) {
    throw new Error(`unsupported tool build policy: ${toolName}`);
  }
  return policy;
}

function resolveMetadataPath(toolRoot) {
  return join(toolRoot, "dist", "metadata.json");
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function hashPath(hash, root, relativePath) {
  const absolutePath = join(root, relativePath);
  const metadata = await lstat(absolutePath);
  const normalizedPath = relativePath.split("\\").join("/");
  if (metadata.isDirectory()) {
    hash.update(`dir:${normalizedPath}\n`);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await hashPath(hash, root, join(relativePath, entry.name));
    }
    return;
  }
  if (metadata.isSymbolicLink()) {
    hash.update(`symlink:${normalizedPath}\n`);
    return;
  }
  hash.update(`file:${normalizedPath}\n`);
  hash.update(await readFile(absolutePath));
}

export async function computeToolSourceHash(toolName, toolRoot) {
  const policy = resolveToolBuildPolicy(toolName);
  const hash = createHash("sha256");
  hash.update(`tool:${toolName}\n`);
  hash.update(`package:${policy.packageName}\n`);
  for (const relativePath of policy.inputs) {
    if (!(await pathExists(join(toolRoot, relativePath)))) {
      throw new Error(`[${toolName}] required build input missing: ${join(toolRoot, relativePath)}`);
    }
    await hashPath(hash, toolRoot, relativePath);
  }
  return hash.digest("hex");
}

export async function writeToolBuildMetadata(toolName, toolRoot) {
  const hash = await computeToolSourceHash(toolName, toolRoot);
  const metadataPath = resolveMetadataPath(toolRoot);
  await mkdir(resolve(toolRoot, "dist"), { recursive: true });
  await writeFile(
    metadataPath,
    `${JSON.stringify({ build: { hash } }, null, 2)}\n`,
    "utf8",
  );
  return { hash, metadataPath };
}

async function readToolBuildMetadata(toolRoot) {
  const metadataPath = resolveMetadataPath(toolRoot);
  try {
    return {
      metadata: JSON.parse(await readFile(metadataPath, "utf8")),
      metadataPath,
    };
  } catch {
    return { metadata: null, metadataPath };
  }
}

function createBuildRequiredError(toolName, toolRoot, reason) {
  const policy = resolveToolBuildPolicy(toolName);
  return new Error(
    `[${toolName}] ${reason} Run "${policy.buildCommand}" first.\n` +
    `tool root: ${toolRoot}\n` +
    `metadata: ${resolveMetadataPath(toolRoot)}`,
  );
}

export async function assertFreshToolBuild(toolName, toolRoot) {
  const policy = resolveToolBuildPolicy(toolName);
  const missingDistEntries = [];
  for (const distEntry of policy.distEntries) {
    const absolutePath = join(toolRoot, distEntry);
    if (!(await pathExists(absolutePath))) {
      missingDistEntries.push(absolutePath);
    }
  }
  if (missingDistEntries.length > 0) {
    throw createBuildRequiredError(
      toolName,
      toolRoot,
      `dist entries not found: ${missingDistEntries.join(", ")}.`,
    );
  }

  const { metadata, metadataPath } = await readToolBuildMetadata(toolRoot);
  if (typeof metadata?.build?.hash !== "string" || metadata.build.hash.length === 0) {
    throw createBuildRequiredError(
      toolName,
      toolRoot,
      `build metadata missing or invalid at ${metadataPath}.`,
    );
  }

  const sourceHash = await computeToolSourceHash(toolName, toolRoot);
  if (metadata.build.hash !== sourceHash) {
    throw createBuildRequiredError(
      toolName,
      toolRoot,
      `dist build metadata hash mismatch.\nexpected: ${metadata.build.hash}\ncurrent: ${sourceHash}`,
    );
  }

  return {
    hash: sourceHash,
    metadataPath,
  };
}

async function main(argv) {
  const [command, toolName, toolRootArg] = argv;
  if (command !== "write") {
    throw new Error(`usage: ${basename(fileURLToPath(import.meta.url))} write <tool-name> [tool-root]`);
  }
  const toolRoot = toolRootArg == null ? process.cwd() : resolve(toolRootArg);
  const result = await writeToolBuildMetadata(toolName, toolRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}

#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertFreshToolBuild } from "../../../scripts/tool-build-metadata.mjs";

const entryDir = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(entryDir, "..");
const distEntry = resolve(toolRoot, "dist/index.mjs");

await assertFreshToolBuild("tools-pack", toolRoot);
await import(pathToFileURL(distEntry).href);

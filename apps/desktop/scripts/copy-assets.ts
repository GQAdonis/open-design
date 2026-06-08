import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceAssets = join(packageRoot, "src", "main", "assets");
const outputAssets = join(packageRoot, "dist", "main", "assets");

await rm(outputAssets, { force: true, recursive: true });
await mkdir(outputAssets, { recursive: true });
await cp(sourceAssets, outputAssets, { recursive: true });

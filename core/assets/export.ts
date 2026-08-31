import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { getGeneration } from "@/lib/storage/generations";
import { safeAssetName, safeJoin } from "@/lib/fs/safe-path";

export interface ExportResult { directory: string; files: string[] }

async function createAvailableDirectory(outputRoot: string, preferredName: string) {
  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const name = suffix === 1 ? preferredName : `${preferredName}-${suffix}`;
    const candidate = safeJoin(outputRoot, name);
    try {
      await mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Không thể tạo thư mục export mới.");
}

export async function exportGeneration(generationId: string, projectRoot: string): Promise<ExportResult> {
  const absoluteProjectRoot = resolve(projectRoot);
  const outputRoot = resolve(absoluteProjectRoot, "generated-assets");
  if (!outputRoot.startsWith(`${absoluteProjectRoot}${sep}`)) throw new Error("Thư mục export phải nằm trong game project.");
  await mkdir(outputRoot, { recursive: true });

  const { root: cacheDirectory, record } = await getGeneration(generationId);
  if (!record.validation.ready) throw new Error("Kết quả chưa vượt qua kiểm tra adapter nên không thể export.");
  const destination = await createAvailableDirectory(outputRoot, safeAssetName(record.name));
  const filesToCopy = [...new Set([record.source.file, record.visual.file, ...record.files.map((file) => file.path)])];
  for (const relativePath of filesToCopy) {
    const target = safeJoin(destination, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(safeJoin(cacheDirectory, relativePath), target);
  }

  const manifest = { ...record, project: safeAssetName(absoluteProjectRoot.split(/[\\/]/).at(-1) || "game-project") };
  await writeFile(safeJoin(destination, "asset.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const readme = [
    "# ContentForge asset package",
    "",
    `Adapter: ${record.adapter.id}`,
    `Asset: ${record.name}`,
    "",
    "Use asset.manifest.json as the package entry point. Adapter-specific integration files are inside integration/ when available.",
    "ContentForge never writes over original game assets. Copy or import these generated files explicitly.",
    "",
  ].join("\n");
  await mkdir(safeJoin(destination, "integration"), { recursive: true });
  await writeFile(safeJoin(destination, "integration/README.md"), readme, "utf8");

  return { directory: destination, files: [...filesToCopy, "asset.manifest.json", "integration/README.md"] };
}

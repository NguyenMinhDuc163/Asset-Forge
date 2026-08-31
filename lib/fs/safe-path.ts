import { resolve, sep } from "node:path";

export function safeJoin(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, relativePath);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error("Đường dẫn file không hợp lệ.");
  }
  return target;
}

export function safeAssetName(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "game-asset";
}

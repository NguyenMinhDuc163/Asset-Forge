import sharp from "sharp";
import type { AssetKind, NormalizedAsset } from "../assets/types";

export interface NormalizeOptions {
  width: number;
  height: number;
  pixelArt?: boolean;
  paletteColours?: number;
}

const defaultTargets: Record<AssetKind, NormalizeOptions> = {
  character: { width: 64, height: 64, pixelArt: true, paletteColours: 128 },
  environment: { width: 1024, height: 576, pixelArt: false, paletteColours: 256 },
  item: { width: 48, height: 48, pixelArt: true, paletteColours: 96 },
  effect: { width: 96, height: 96, pixelArt: true, paletteColours: 128 },
};

export function getDefaultNormalizeOptions(kind: AssetKind): NormalizeOptions {
  return defaultTargets[kind];
}

export async function normalizeImage(input: Buffer, options: NormalizeOptions): Promise<NormalizedAsset> {
  if (!input.length) throw new Error("Ảnh nguồn không có dữ liệu.");

  let metadata;
  try {
    metadata = await sharp(input, { failOn: "error", limitInputPixels: 64_000_000 }).metadata();
  } catch (error) {
    console.error("Sharp could not read source image", error);
    throw new Error("Ảnh nguồn bị hỏng hoặc không thuộc định dạng được hỗ trợ.");
  }

  if (!metadata.width || !metadata.height) throw new Error("Không thể xác định kích thước ảnh nguồn.");

  let image = sharp(input, { failOn: "error", limitInputPixels: 64_000_000 }).rotate();
  if (metadata.hasAlpha) {
    image = image.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 });
  }

  const resizeKernel = options.pixelArt ? sharp.kernel.nearest : sharp.kernel.lanczos3;
  const { data, info } = await image
    .ensureAlpha()
    .resize(options.width, options.height, {
      fit: "contain",
      kernel: resizeKernel,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alphaOffset = offset + 3;
    if (data[alphaOffset] < 8) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[alphaOffset] = 0;
    }
  }

  const buffer = await sharp(data, { raw: info })
    .png({ palette: true, colours: options.paletteColours || 128, compressionLevel: 9 })
    .toBuffer();

  return { buffer, width: options.width, height: options.height, format: "png", hasAlpha: true };
}

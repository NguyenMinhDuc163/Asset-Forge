import sharp from "sharp";
import type { AssetKind, NormalizedAsset } from "../assets/types";

export interface NormalizeOptions {
  width: number;
  height: number;
  pixelArt?: boolean;
  paletteColours?: number;
  removeSolidBackground?: boolean;
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
  if (options.removeSolidBackground) {
    const { data, info } = await image
      .clone()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixelAt = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]] as const;
    };
    const corners = [pixelAt(0, 0), pixelAt(info.width - 1, 0), pixelAt(0, info.height - 1), pixelAt(info.width - 1, info.height - 1)];
    const background = [0, 1, 2].map((channel) => Math.round(corners.reduce((sum, colour) => sum + colour[channel], 0) / corners.length));
    const cornerSpread = Math.max(...corners.flatMap((colour) => colour.map((value, channel) => Math.abs(value - background[channel]))));
    if (cornerSpread <= 36) {
      for (let offset = 0; offset < data.length; offset += info.channels) {
        const distance = Math.max(
          Math.abs(data[offset] - background[0]),
          Math.abs(data[offset + 1] - background[1]),
          Math.abs(data[offset + 2] - background[2]),
        );
        if (distance <= 24) data[offset + 3] = 0;
        else if (distance < 48) data[offset + 3] = Math.min(data[offset + 3], Math.round(((distance - 24) / 24) * 255));
      }
    }
    image = sharp(data, { raw: info }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 });
  } else if (metadata.hasAlpha) {
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

  return {
    buffer,
    width: options.width,
    height: options.height,
    format: "png",
    hasAlpha: true,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
  };
}

import { perceptualHash } from "../../utils/image-hash.js";
import { logoFileKey } from "../../utils/companies-file.js";

// Decodes logo images (files the user picked, LinkedIn's dropdown logos) to
// pixels in the side panel and hashes them (image-hash.js). Images are drawn
// at most MAX_SIDE px wide or high: plenty for a 32×32 hash, and it bounds
// the work for large files.
const MAX_SIDE = 256;
const THUMB_SIDE = 48;

async function decode(blob, maxSide) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas;
}

export async function hashBlob(blob) {
  const canvas = await decode(blob, MAX_SIDE);
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  return perceptualHash(data, canvas.width, canvas.height);
}

// Small PNG data URL for showing the logo in the panel.
async function thumbnail(blob) {
  const canvas = await decode(blob, THUMB_SIDE);
  const png = await canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(png);
  });
}

// Hashes the logo of every company that has a logoPath, matching it by file
// name among `files` (a folder the user picked). Returns a Map
// name → { hash, thumb } and the companies whose file wasn't found or
// couldn't be read. Calls onProgress(done, total) as it goes.
export async function loadCompanyLogos(companies, files, onProgress = () => {}) {
  const byName = new Map([...files].map((file) => [file.name.toLowerCase(), file]));
  const wanted = companies.filter((company) => company.logoPath);
  const logos = new Map();
  const missing = [];
  const failed = [];

  for (const [done, company] of wanted.entries()) {
    const file = byName.get(logoFileKey(company.logoPath));
    if (!file) {
      missing.push(company.name);
    } else {
      try {
        const hash = await hashBlob(file);
        if (hash) logos.set(company.name, { hash, thumb: await thumbnail(file) });
        else failed.push(company.name);
      } catch {
        failed.push(company.name);
      }
    }
    onProgress(done + 1, wanted.length);
  }
  return { logos, missing, failed };
}

// Hashes of LinkedIn dropdown logos, cached per URL for the panel's lifetime
// (the same companies come up across searches). Resolves to null when the
// image can't be fetched or decoded.
const remoteHashes = new Map();

export function hashRemoteLogo(url) {
  if (!remoteHashes.has(url)) {
    remoteHashes.set(
      url,
      fetch(url, { credentials: "omit" })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.blob();
        })
        .then(hashBlob)
        .catch(() => null)
    );
  }
  return remoteHashes.get(url);
}

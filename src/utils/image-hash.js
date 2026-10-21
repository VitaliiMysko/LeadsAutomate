// Perceptual hash (pHash) of a logo, for telling whether two images show the
// same logo despite different size, padding, compression or background.
// Works on raw RGBA pixels, so it's independent of how they were decoded.
//
// Steps: composite transparency on white (a logo that is all white, made for
// dark backgrounds, is taken from its alpha shape instead); crop to the
// content, i.e. rows and columns with pixels clearly different from the
// background (the corners' colour), which removes padding such as the
// Umbraco site's and ignores sparse JPEG noise; downscale to 32×32 greyscale;
// take the 8×8 lowest frequencies of its DCT; one bit per coefficient: above
// or below their median. Similar images differ in few of the 64 bits.
// Compare with logoDistance, which also matches a logo with its
// light-on-dark version.

const SAMPLE = 32;
const LOW = 8;
// A pixel is content when it differs from the background by at least this
// share of the image's largest difference (and at least MIN_CONTRAST).
const CONTENT_SHARE = 0.25;
const MIN_CONTRAST = 16;
// A row / column is content when it holds at least this many content pixels.
const MIN_LINE_PIXELS = 2;

// RGBA → RGB composited on white, as Float32Array [r, g, b, r, g, b, ...].
// With `fromAlpha`, opaque pixels become black whatever their colour.
function composite(rgba, fromAlpha = false) {
  const rgb = new Float32Array((rgba.length / 4) * 3);
  for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
    const alpha = rgba[p + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      const value = fromAlpha ? 0 : rgba[p + channel];
      rgb[q + channel] = value * alpha + 255 * (1 - alpha);
    }
  }
  return rgb;
}

// Bounding box of the content inside `region` (default: the whole image),
// against that region's background (average of its four corners); null
// when the region is blank.
function regionContentBox(rgb, width, region) {
  const { x: rx, y: ry, width: rw, height: rh } = region;
  const corners = [
    [rx, ry],
    [rx + rw - 1, ry],
    [rx, ry + rh - 1],
    [rx + rw - 1, ry + rh - 1],
  ].map(([x, y]) => (y * width + x) * 3);
  const background = [0, 1, 2].map((channel) => corners.reduce((sum, q) => sum + rgb[q + channel], 0) / 4);

  const diff = new Float32Array(rw * rh);
  let max = 0;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const q = ((ry + y) * width + rx + x) * 3;
      const value = Math.max(
        Math.abs(rgb[q] - background[0]),
        Math.abs(rgb[q + 1] - background[1]),
        Math.abs(rgb[q + 2] - background[2])
      );
      diff[y * rw + x] = value;
      if (value > max) max = value;
    }
  }
  if (max < MIN_CONTRAST) return null;
  const threshold = Math.max(MIN_CONTRAST, max * CONTENT_SHARE);

  const rows = new Uint32Array(rh);
  const columns = new Uint32Array(rw);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (diff[y * rw + x] < threshold) continue;
      rows[y]++;
      columns[x]++;
    }
  }
  const lines = (counts) => {
    const minPixels = Math.min(MIN_LINE_PIXELS, Math.max(...counts));
    const first = counts.findIndex((count) => count >= minPixels);
    let last = counts.length - 1;
    while (last > first && counts[last] < minPixels) last--;
    return [first, last];
  };
  const [top, bottom] = lines(rows);
  const [left, right] = lines(columns);
  return { x: rx + left, y: ry + top, width: right - left + 1, height: bottom - top + 1 };
}

// Bounding box of the content, or null for a blank image. Crops again while
// the cropped area has a background of its own (a logo on a coloured panel,
// itself padded with white), so both versions end up at the logo itself.
export function contentBox(rgb, width, height) {
  let box = regionContentBox(rgb, width, { x: 0, y: 0, width, height });
  for (let pass = 0; box && pass < 2; pass++) {
    if (box.width < 4 || box.height < 4) break;
    const inner = regionContentBox(rgb, width, box);
    if (!inner || (inner.width === box.width && inner.height === box.height)) break;
    box = inner;
  }
  return box;
}

// Area-averaged SAMPLE×SAMPLE greyscale of the box.
function sampleGrey(rgb, width, box) {
  const grey = new Float64Array(SAMPLE * SAMPLE);
  for (let sy = 0; sy < SAMPLE; sy++) {
    const y0 = box.y + Math.floor((sy * box.height) / SAMPLE);
    const y1 = Math.max(y0 + 1, box.y + Math.floor(((sy + 1) * box.height) / SAMPLE));
    for (let sx = 0; sx < SAMPLE; sx++) {
      const x0 = box.x + Math.floor((sx * box.width) / SAMPLE);
      const x1 = Math.max(x0 + 1, box.x + Math.floor(((sx + 1) * box.width) / SAMPLE));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const q = (y * width + x) * 3;
          sum += 0.299 * rgb[q] + 0.587 * rgb[q + 1] + 0.114 * rgb[q + 2];
        }
      }
      grey[sy * SAMPLE + sx] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return grey;
}

const COSINES = Array.from({ length: LOW }, (_, u) =>
  Array.from({ length: SAMPLE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SAMPLE)))
);

// 64-bit pHash as 16 hex characters, or null for a blank image.
export function perceptualHash(rgba, width, height) {
  if (!width || !height || rgba.length < width * height * 4) return null;
  let rgb = composite(rgba);
  let box = contentBox(rgb, width, height);
  if (!box) {
    // A white logo on a transparent background vanishes on white: use its shape.
    rgb = composite(rgba, true);
    box = contentBox(rgb, width, height);
  }
  if (!box) return null;
  const grey = sampleGrey(rgb, width, box);

  const coefficients = [];
  for (let v = 0; v < LOW; v++) {
    for (let u = 0; u < LOW; u++) {
      let sum = 0;
      for (let y = 0; y < SAMPLE; y++) {
        for (let x = 0; x < SAMPLE; x++) sum += grey[y * SAMPLE + x] * COSINES[u][x] * COSINES[v][y];
      }
      coefficients.push(sum);
    }
  }
  // The DC term (overall brightness) is left out of the median.
  const median = [...coefficients.slice(1)].sort((a, b) => a - b)[Math.floor((coefficients.length - 1) / 2)];

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) nibble = (nibble << 1) | (coefficients[i + bit] > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

// Number of differing bits (0 = same logo, 64 = opposite).
export function hashDistance(a, b) {
  let distance = 0;
  for (let i = 0; i < 16; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

// Distance between two logos, 0..32: a light-on-dark version of a logo has
// (nearly) inverted bits, so the inverse's distance counts as well.
export function logoDistance(a, b) {
  const distance = hashDistance(a, b);
  return Math.min(distance, 64 - distance);
}

// 0..100 % for the log and UI, from a logoDistance.
export function logoSimilarity(distance) {
  return Math.round((1 - distance / 32) * 100);
}

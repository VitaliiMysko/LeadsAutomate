import { perceptualHash, hashDistance, logoDistance, logoSimilarity } from "../src/utils/image-hash.js";

// RGBA image of `width`×`height` on `background`, with `shapes` (rectangles
// in 0..1 units of the drawing area) painted `color`. The drawing area is
// the image minus `padding` px on every side, like the Umbraco logos' pad.
function makeImage({ width, height, padding = 0, background = [255, 255, 255, 255], color = [20, 40, 160, 255], shapes }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) data.set(background, p);
  const areaWidth = width - 2 * padding;
  const areaHeight = height - 2 * padding;
  for (const [x0, y0, x1, y1] of shapes) {
    for (let y = Math.round(padding + y0 * areaHeight); y < Math.round(padding + y1 * areaHeight); y++) {
      for (let x = Math.round(padding + x0 * areaWidth); x < Math.round(padding + x1 * areaWidth); x++) {
        data.set(color, (y * width + x) * 4);
      }
    }
  }
  return data;
}

// Two different "logos" made of rectangles.
const LOGO_A = [
  [0, 0, 0.2, 1],
  [0, 0.8, 0.7, 1],
  [0.45, 0.1, 0.6, 0.6],
  [0.8, 0, 1, 0.4],
];
const LOGO_B = [
  [0, 0, 1, 0.2],
  [0.4, 0, 0.6, 1],
  [0.1, 0.5, 0.3, 0.9],
  [0.75, 0.6, 1, 1],
];

const hashOf = (options) => perceptualHash(makeImage(options), options.width, options.height);

describe("perceptualHash", () => {
  const reference = hashOf({ width: 120, height: 60, shapes: LOGO_A });

  test("is 16 hex characters", () => {
    expect(reference).toMatch(/^[0-9a-f]{16}$/);
  });

  test("same logo, different size and padding (as Umbraco pads its logos): near-identical", () => {
    const padded = hashOf({ width: 475, height: 316, padding: 70, shapes: LOGO_A });
    const small = hashOf({ width: 48, height: 24, shapes: LOGO_A });
    expect(hashDistance(reference, padded)).toBeLessThanOrEqual(6);
    expect(hashDistance(reference, small)).toBeLessThanOrEqual(10);
  });

  test("same logo on a coloured or transparent background: near-identical", () => {
    const onGrey = hashOf({ width: 120, height: 60, padding: 10, background: [235, 235, 235, 255], shapes: LOGO_A });
    const transparent = hashOf({ width: 120, height: 60, padding: 10, background: [0, 0, 0, 0], shapes: LOGO_A });
    expect(hashDistance(reference, onGrey)).toBeLessThanOrEqual(6);
    expect(hashDistance(reference, transparent)).toBeLessThanOrEqual(6);
  });

  test("white logo on a transparent background: matched by its shape", () => {
    const whiteOnTransparent = hashOf({ width: 120, height: 60, padding: 10, background: [0, 0, 0, 0], color: [255, 255, 255, 255], shapes: LOGO_A });
    expect(whiteOnTransparent).not.toBeNull();
    expect(logoDistance(reference, whiteOnTransparent)).toBeLessThanOrEqual(6);
  });

  test("light-on-dark version of a logo: matched by logoDistance", () => {
    const inverted = hashOf({ width: 120, height: 60, padding: 10, background: [10, 20, 60, 255], color: [255, 255, 255, 255], shapes: LOGO_A });
    expect(logoDistance(reference, inverted)).toBeLessThanOrEqual(6);
  });

  test("logo on a coloured panel padded with white: cropped to the logo itself", () => {
    const width = 140;
    const height = 80;
    const panel = makeImage({ width: 100, height: 50, padding: 8, background: [230, 240, 250, 255], shapes: LOGO_A });
    const data = makeImage({ width, height, shapes: [] });
    for (let y = 0; y < 50; y++) data.set(panel.subarray(y * 100 * 4, (y + 1) * 100 * 4), ((y + 15) * width + 20) * 4);
    expect(logoDistance(reference, perceptualHash(data, width, height))).toBeLessThanOrEqual(6);
  });

  test("different logos: far apart", () => {
    const other = hashOf({ width: 120, height: 60, shapes: LOGO_B });
    expect(logoDistance(reference, other)).toBeGreaterThanOrEqual(20);
  });

  test("blank image has no hash", () => {
    expect(hashOf({ width: 40, height: 40, shapes: [] })).toBeNull();
    expect(perceptualHash(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });
});

describe("hashDistance / logoDistance / logoSimilarity", () => {
  test("counts differing bits", () => {
    expect(hashDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hashDistance("0000000000000000", "000000000000000f")).toBe(4);
    expect(hashDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
  });

  test("logoDistance treats inverted hashes as the same logo", () => {
    expect(logoDistance("ffffffffffffffff", "0000000000000000")).toBe(0);
    expect(logoDistance("0000000000000000", "000000000000000f")).toBe(4);
    expect(logoDistance("00000000ffffffff", "0000000000000000")).toBe(32);
  });

  test("similarity in percent", () => {
    expect(logoSimilarity(0)).toBe(100);
    expect(logoSimilarity(8)).toBe(75);
    expect(logoSimilarity(32)).toBe(0);
  });
});

// Reading and writing images in Node (the page uses a canvas instead).
import fs from "node:fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export function readImage(file) {
  const buf = fs.readFileSync(file);
  if (file.toLowerCase().endsWith(".png")) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  }
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function writePng(file, { width, height, data }) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  fs.writeFileSync(file, PNG.sync.write(png));
}

export function writeJpeg(file, { width, height, data }, quality = 88) {
  fs.writeFileSync(file, jpeg.encode({ width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) }, quality).data);
}

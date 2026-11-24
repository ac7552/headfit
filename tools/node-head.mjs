// Loads the packed head from data/ in Node.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHead } from "../src/head.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export function nodeHead(dir = path.join(here, "..", "data")) {
  const header = JSON.parse(fs.readFileSync(path.join(dir, "ict-head.json"), "utf8"));
  const buf = fs.readFileSync(path.join(dir, "ict-head.bin"));
  return readHead(header, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

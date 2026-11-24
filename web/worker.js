// Fits and paints the head off the page's main thread.
import { bakeSkin } from "../src/bake.js";
import { fitHead } from "../src/fit.js";
import { hairColour } from "../src/hair.js";
import { readHead } from "../src/head.js";

let head = null;
const ready = (async () => {
  const header = await (await fetch("../data/ict-head.json")).json();
  const buffer = await (await fetch("../data/ict-head.bin")).arrayBuffer();
  head = readHead(header, buffer);
})();

self.onmessage = async ({ data }) => {
  await ready;
  const { id, views, images, options, paint } = data;
  try {
    const t0 = performance.now();
    const fit = fitHead(head, views, options);
    const t1 = performance.now();
    const out = {
      id,
      fitted: fit.fitted,
      neutral: fit.neutral,
      weights: fit.weights,
      report: fit.report,
      views: fit.views,
      ms: { fit: Math.round(t1 - t0) },
    };
    const transfer = [fit.fitted.buffer, fit.neutral.buffer];
    if (paint) {
      const tex = bakeSkin(head, fit, images);
      out.texture = { width: tex.width, height: tex.height, data: tex.data };
      out.tone = tex.tone;
      out.iris = tex.iris;
      out.hair = hairColour(head, fit, images[0]);
      out.ms.paint = Math.round(performance.now() - t1);
      transfer.push(tex.data.buffer);
    }
    self.postMessage(out, transfer);
  } catch (error) {
    self.postMessage({ id, error: String(error.message || error) });
  }
};

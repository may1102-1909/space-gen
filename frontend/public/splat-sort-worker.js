if (typeof self !== 'undefined') {
  self.$RefreshReg$ = self.$RefreshReg$ || function() {};
  self.$RefreshSig$ = self.$RefreshSig$ || function() { return function() {}; };
}
// ../../external/egs-core/packages/utils/splat-utils/worker.ts
var DEPTH_INFINITY = 31743;
var buckets = new Uint32Array(65536);
function sortSplats(counts, sorting, order) {
  buckets.fill(0);
  for (let i = 0; i < counts; i++) {
    buckets[sorting[i]]++;
  }
  let activeCount = 0;
  for (let i = DEPTH_INFINITY - 1; i >= 0; i--) {
    const v = buckets[i];
    buckets[i] = activeCount;
    activeCount += v;
  }
  for (let i = 0; i < counts; i++) {
    const v = sorting[i];
    if (v < DEPTH_INFINITY) {
      order[buckets[v]++] = i;
    }
  }
  return activeCount;
}
var DEPTH_INFINITY_F32 = 2139095040 - 1;
var RADIX_BITS = 16;
var RADIX = 1 << RADIX_BITS;
var RADIX_MASK = RADIX - 1;
var HI_OFFSET = RADIX;
var bucket16;
var scratch;
function sort32Splats(counts, sorting, order) {
  if (!bucket16) {
    bucket16 = new Uint32Array(RADIX * 2);
  }
  if (!scratch || scratch.length < counts) {
    scratch = new Uint32Array(counts);
  }
  const buckets2 = bucket16;
  buckets2.fill(0);
  let activeCount = 0;
  for (let i = 0; i < counts; ++i) {
    const key = sorting[i];
    if (key >= DEPTH_INFINITY_F32) {
      continue;
    }
    const inv = ~key >>> 0;
    buckets2[inv & RADIX_MASK] += 1;
    buckets2[HI_OFFSET + (inv >>> RADIX_BITS)] += 1;
    order[activeCount++] = i;
  }
  let offset = 0;
  for (let b = 0; b < RADIX; ++b) {
    const count = buckets2[b];
    buckets2[b] = offset;
    offset += count;
  }
  for (let i = 0; i < activeCount; ++i) {
    const idx = order[i];
    const inv = ~sorting[idx] >>> 0;
    scratch[buckets2[inv & RADIX_MASK]++] = idx;
  }
  offset = 0;
  for (let b = 0; b < RADIX; ++b) {
    const p = HI_OFFSET + b;
    const count = buckets2[p];
    buckets2[p] = offset;
    offset += count;
  }
  for (let i = 0; i < activeCount; ++i) {
    const idx = scratch[i];
    const inv = ~sorting[idx] >>> 0;
    order[buckets2[HI_OFFSET + (inv >>> RADIX_BITS)]++] = idx;
  }
  return activeCount;
}
self.onmessage = async (event) => {
  try {
    const message = event.data;
    switch (message.taskType) {
      case "SortSplats" /* SortSplats */: {
        const { count, sorting, ordering } = event.data.payload;
        const activeCount = sorting instanceof Uint32Array ? sort32Splats(count, sorting, ordering) : sortSplats(count, sorting, ordering);
        const payload = {
          status: 0 /* Success */,
          payload: { activeCount, sorting, ordering }
        };
        postMessage(payload, [sorting.buffer, ordering.buffer]);
        return;
      }
      default: {
        const check = message.taskType;
        throw new Error(`Unsupported task type: ${check}.`);
      }
    }
  } catch (e) {
    console.error(e);
    postMessage({ status: 1 /* Fail */, payload: e.toString() });
  }
};
//# sourceMappingURL=splat-sort-worker.js.map

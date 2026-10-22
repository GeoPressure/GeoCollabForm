<script setup>
// Histogram of past tag weights: the chosen battery in colour over all tags of this type
// in grey, with the 3% and 5% body-mass limits in grams
import { computed } from "vue";
import { quantile } from "../../lib/plannerHistory";

const props = defineProps({
  selected: { type: Array, required: true },
  all: { type: Array, required: true },
  bodyMass: { type: Number, default: null },
  // Logger weight shown in the weight tile; defaults to the median of the selected tags
  median: { type: Number, default: null },
  selectedLabel: { type: String, default: "" },
});

const width = 640;
const height = 210;
const m = { top: 34, right: 16, bottom: 40, left: 40 };
const binWidth = 0.05;

const limits = computed(() =>
  props.bodyMass > 0
    ? [
        { pct: 3, g: props.bodyMass * 0.03 },
        { pct: 5, g: props.bodyMass * 0.05 },
      ]
    : []
);

const domain = computed(() => {
  const ref = props.all.length ? props.all : props.selected;
  let lo = quantile(ref, 0.005) ?? 0.5;
  let hi = quantile(ref, 0.995) ?? 3;
  // Keep the limits in view unless they are far outside the tag weights
  for (const l of limits.value) {
    if (l.g < lo && l.g > lo - 1) lo = l.g;
    if (l.g > hi && l.g < hi + 1.5) hi = l.g;
  }
  return [Math.floor(lo / binWidth) * binWidth - binWidth, Math.ceil(hi / binWidth) * binWidth + binWidth];
});

function bin(values) {
  const [lo, hi] = domain.value;
  const n = Math.round((hi - lo) / binWidth);
  const counts = new Array(n).fill(0);
  for (const v of values) {
    const i = Math.floor((v - lo) / binWidth + 1e-9);
    if (i >= 0 && i < n) counts[i] += 1;
  }
  return counts;
}

const allCounts = computed(() => bin(props.all));
const selCounts = computed(() => bin(props.selected));
const yMax = computed(() => Math.max(1, ...allCounts.value, ...selCounts.value));

const plotW = width - m.left - m.right;
const plotH = height - m.top - m.bottom;
const x = (g) => m.left + ((g - domain.value[0]) / (domain.value[1] - domain.value[0])) * plotW;
const y = (c) => m.top + plotH - (c / yMax.value) * plotH;

const bars = computed(() =>
  allCounts.value.map((all, i) => {
    const g0 = domain.value[0] + i * binWidth;
    return { i, g0, all, sel: selCounts.value[i], x: x(g0) + 1, w: Math.max(1, x(g0 + binWidth) - x(g0) - 2) };
  })
);

const xTicks = computed(() => {
  const out = [];
  const step = domain.value[1] - domain.value[0] > 2 ? 0.5 : 0.25;
  for (let g = Math.ceil(domain.value[0] / step) * step; g <= domain.value[1] + 1e-9; g += step) out.push(+g.toFixed(2));
  return out;
});
const yTicks = computed(() => {
  const step = Math.max(1, Math.ceil(yMax.value / 4 / 10) * 10);
  const out = [];
  for (let c = 0; c <= yMax.value; c += step) out.push(c);
  return out;
});

const median = computed(() => props.median ?? quantile(props.selected, 0.5));
const inView = (g) => g >= domain.value[0] && g <= domain.value[1];
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" class="weight-hist" role="img" aria-label="Histogram of past tag weights">
    <g class="wh-grid">
      <g v-for="c in yTicks" :key="`y${c}`">
        <line :x1="m.left" :x2="width - m.right" :y1="y(c)" :y2="y(c)" />
        <text :x="m.left - 6" :y="y(c) + 4" text-anchor="end">{{ c }}</text>
      </g>
      <g v-for="g in xTicks" :key="`x${g}`">
        <text :x="x(g)" :y="height - m.bottom + 16" text-anchor="middle">{{ g.toFixed(2) }}</text>
      </g>
      <text :x="width - m.right" :y="height - 6" text-anchor="end">tag weight (g)</text>
      <text :x="m.left - 30" :y="m.top - 12">tags</text>
    </g>

    <g v-for="b in bars" :key="b.i">
      <title>{{ b.g0.toFixed(2) }}–{{ (b.g0 + binWidth).toFixed(2) }} g: {{ b.sel }} {{ selectedLabel }} · {{ b.all }} all</title>
      <rect :x="b.x" :y="m.top" :width="b.w" :height="plotH" fill="transparent" />
      <rect v-if="b.all" :x="b.x" :y="y(b.all)" :width="b.w" :height="y(0) - y(b.all)" rx="2" class="wh-bar-all" />
      <rect v-if="b.sel" :x="b.x" :y="y(b.sel)" :width="b.w" :height="y(0) - y(b.sel)" rx="2" class="wh-bar-sel" />
    </g>
    <line :x1="m.left" :x2="width - m.right" :y1="y(0)" :y2="y(0)" class="wh-axis" />

    <g v-if="Number.isFinite(median) && inView(median)">
      <line :x1="x(median)" :x2="x(median)" :y1="m.top - 6" :y2="y(0)" class="wh-median-halo" />
      <line :x1="x(median)" :x2="x(median)" :y1="m.top - 6" :y2="y(0)" class="wh-median" />
      <text :x="x(median)" :y="m.top - 11" text-anchor="middle" class="wh-label wh-label--median">logger {{ median.toFixed(2) }} g</text>
    </g>
    <g v-for="(l, i) in limits" :key="l.pct">
      <template v-if="inView(l.g)">
        <line :x1="x(l.g)" :x2="x(l.g)" :y1="m.top + 6" :y2="y(0)" class="wh-limit" />
        <text
          :x="x(l.g) > width - 110 ? x(l.g) - 4 : x(l.g) + 4"
          :y="m.top + 16 + i * 14"
          :text-anchor="x(l.g) > width - 110 ? 'end' : 'start'"
          class="wh-label wh-label--limit"
        >
          {{ l.pct }}% = {{ l.g.toFixed(2) }} g
        </text>
      </template>
    </g>
  </svg>
</template>

<style scoped>
.weight-hist {
  width: 100%;
  height: auto;
  font-family: inherit;
  font-size: 11px;
}
.wh-grid line {
  stroke: var(--gc-color-border, #d7dfda);
  stroke-width: 1;
}
.wh-grid text {
  fill: var(--gc-color-muted, #60716d);
}
.wh-axis {
  stroke: var(--gc-color-muted, #60716d);
}
.wh-bar-all {
  fill: var(--gc-color-border, #d7dfda);
}
.wh-bar-sel {
  fill: rgb(var(--v-theme-info));
}
.wh-median-halo {
  stroke: var(--gc-color-surface, #ffffff);
  stroke-width: 6;
}
.wh-median {
  stroke: rgb(var(--v-theme-info));
  stroke-width: 2.5;
}
.wh-limit {
  stroke: rgb(var(--v-theme-error));
  stroke-width: 2;
  stroke-dasharray: 4 3;
}
.wh-label {
  fill: var(--gc-color-text, #1f2a28);
  font-weight: 700;
}
.wh-label--median {
  fill: rgb(var(--v-theme-info));
  font-size: 13px;
}
.wh-label--limit {
  fill: rgb(var(--v-theme-error));
}
</style>

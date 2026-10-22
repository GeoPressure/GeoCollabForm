<script setup>
// Horizontal bars on a "days after logging start" axis, with dashed markers (e.g. 1 year).
// row: { label, value, hi? (range value–hi, bar to its middle), q?: [q25, median, q75], tone: 'model' | 'past', detail }
// Pass the same maxDay to several charts so their axes line up.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatDays } from "../../lib/loggerModel";

const props = defineProps({
  rows: { type: Array, required: true },
  markers: { type: Array, default: () => [] },
  maxDay: { type: Number, default: 730 },
  width: { type: Number, default: 560 },
});

const labelWidth = 120;
// Drawn at the container's pixel width so the text keeps its size on any screen
const el = ref(null);
const measured = ref(null);
let observer = null;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    measured.value = Math.round(entry.contentRect.width) || null;
  });
  observer.observe(el.value);
});
onBeforeUnmount(() => observer?.disconnect());
const width = computed(() => Math.max(320, measured.value || props.width));
const rowHeight = 28;
const top = 28;

const maxDay = computed(() => props.maxDay);

// Room on the right for the value labels
// Values are in the hover text, so the plot runs to the right edge
const plotWidth = computed(() => width.value - labelWidth - 16);
const x = (d) => labelWidth + (Math.min(Math.max(d, 0), maxDay.value) / maxDay.value) * plotWidth.value;
const height = computed(() => top + props.rows.length * rowHeight + 38);
const tone = (row) => toneColor[row.tone] || toneColor.model;
const hasRange = (row) => Number.isFinite(row.hi) && Math.round(row.hi) !== Math.round(row.value);
const mid = (row) => (hasRange(row) ? (row.value + row.hi) / 2 : row.value);

const ticks = computed(() => {
  // Every 3, 6, 12 or 24 months (at most about 10 ticks), labelled "6m", "1y", "1y 6m"
  const months = [3, 6, 12, 24, 60].find((m) => maxDay.value / ((m * 365) / 12) <= 10) ?? 120;
  const out = [];
  for (let m = 0; (m * 365) / 12 <= maxDay.value + 1; m += months) {
    const y = Math.floor(m / 12);
    const r = m % 12;
    out.push({ day: (m * 365) / 12, label: m === 0 ? "0" : [y ? `${y}y` : "", r ? `${r}m` : ""].filter(Boolean).join(" ") });
  }
  return out;
});

// Hovered row, shown with a tooltip
const hover = ref(null);
const tip = computed(() => {
  const i = hover.value;
  if (i === null) return null;
  const row = props.rows[i];
  const end = row.q ? row.q[2] : Number.isFinite(row.hi) ? row.hi : row.value;
  return {
    left: `${(x(Number.isFinite(end) ? end : 0) / width.value) * 100}%`,
    top: `${((top + i * rowHeight) / height.value) * 100}%`,
    title: `${row.label}: ${valueLabel(row) || "no estimate"}`,
    detail: row.detail,
  };
});

const toneColor = {
  model: "rgb(var(--v-theme-info))",
  past: "rgb(var(--v-theme-secondary))",
};

function valueLabel(row) {
  const v = row.q ? row.q[1] : row.value;
  if (!Number.isFinite(v)) return "";
  // Bars past the axis end are cut; the label still gives the real value
  if (hasRange(row)) return `${formatDays(mid(row))} ± ${formatDays((row.hi - row.value) / 2)}`;
  return formatDays(v);
}
</script>

<template>
  <div class="chart-wrap">
  <svg ref="el" :viewBox="`0 0 ${width} ${height}`" class="timeline-chart" role="img" aria-label="Expected recording time per limit">
    <g class="timeline-grid">
      <g v-for="t in ticks" :key="t.day">
        <line :x1="x(t.day)" :x2="x(t.day)" :y1="top - 6" :y2="height - 36" />
        <text :x="x(t.day)" :y="height - 22" text-anchor="middle">{{ t.label }}</text>
      </g>
      <text :x="labelWidth + plotWidth" :y="height - 6" text-anchor="end" class="timeline-axis-title">time after logging start</text>
    </g>

    <g v-for="(m, i) in markers" :key="m.label" class="timeline-marker">
      <line :x1="x(m.day)" :x2="x(m.day)" :y1="top - 8" :y2="height - 36" />
      <text :x="x(m.day)" :y="14 + (i % 2) * 13" :text-anchor="m.day === 0 ? 'start' : 'middle'">{{ m.label }}</text>
    </g>

    <g
      v-for="(row, i) in rows"
      :key="row.label"
      :transform="`translate(0, ${top + i * rowHeight})`"
      :class="{ 'timeline-hover': hover === i }"
      @mouseenter="hover = i"
      @mouseleave="hover = null"
    >
      <rect :x="0" :y="0" :width="width" :height="rowHeight" rx="4" class="timeline-hit" />
      <text :x="labelWidth - 10" :y="rowHeight / 2 + 4" text-anchor="end" class="timeline-label">{{ row.label }}</text>

      <template v-if="row.q">
        <line :x1="x(row.q[0])" :x2="x(row.q[2])" :y1="rowHeight / 2" :y2="rowHeight / 2" class="timeline-whisker" />
        <rect
          :x="x(row.q[0])"
          :y="8"
          :width="Math.max(2, x(row.q[2]) - x(row.q[0]))"
          :height="rowHeight - 16"
          rx="4"
          :fill="tone(row)"
          fill-opacity="0.35"
        />
        <line :x1="x(row.q[1])" :x2="x(row.q[1])" :y1="6" :y2="rowHeight - 6" :stroke="tone(row)" stroke-width="3" />
      </template>
      <template v-else-if="Number.isFinite(row.value)">
        <!-- Bar to the mean; a model range (row.hi) is drawn as a black line with end caps -->
        <rect
          :x="labelWidth"
          :y="8"
          :width="Math.max(2, x(mid(row)) - labelWidth)"
          :height="rowHeight - 16"
          rx="4"
          :fill="tone(row)"
        />
        <rect
          v-if="hasRange(row)"
          :x="x(row.value)"
          :y="rowHeight / 2 - 2"
          :width="Math.max(4, x(row.hi) - x(row.value))"
          height="4"
          rx="2"
          class="timeline-range"
        />
      </template>
      <!-- Bars cut at the axis end show their real value inside the bar -->
      <text
        v-if="!row.q && Number.isFinite(row.value) && mid(row) > maxDay"
        :x="labelWidth + plotWidth - 8"
        :y="rowHeight / 2 + 4"
        text-anchor="end"
        class="timeline-value-inside"
      >
        {{ valueLabel(row) }} ›
      </text>
      <text v-if="!valueLabel(row)" :x="labelWidth + 4" :y="rowHeight / 2 + 4" class="timeline-value timeline-value--muted">
        {{ row.detail || "no estimate" }}
      </text>
    </g>
  </svg>
  <div v-if="tip" class="chart-tip" :style="{ left: tip.left, top: tip.top }">
    <strong>{{ tip.title }}</strong>
    <div v-if="tip.detail">{{ tip.detail }}</div>
  </div>
  </div>
</template>

<style scoped>
.timeline-chart {
  width: 100%;
  height: auto;
  font-size: 12px;
  font-family: inherit;
}
.timeline-value-inside {
  fill: #ffffff;
  font-size: 11px;
  font-weight: 700;
}
.timeline-hit {
  fill: transparent;
}
.timeline-hover .timeline-value-inside {
  fill: #ffffff;
  font-size: 11px;
  font-weight: 700;
}
.timeline-hit {
  fill: var(--gc-color-text, #1f2a28);
  fill-opacity: 0.05;
}
.timeline-hover rect:not(.timeline-hit):not(.timeline-range) {
  filter: brightness(1.15);
}
.timeline-grid line {
  stroke: var(--gc-color-border, #d7dfda);
  stroke-width: 1;
}
.timeline-grid text,
.timeline-axis-title {
  fill: var(--gc-color-muted, #60716d);
  font-size: 11px;
}
.timeline-marker line {
  stroke: var(--gc-color-text, #1f2a28);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.timeline-marker text {
  fill: var(--gc-color-text, #1f2a28);
  font-size: 11px;
  font-weight: 700;
}
.timeline-label {
  fill: var(--gc-color-text, #1f2a28);
}
.timeline-value {
  fill: var(--gc-color-text, #1f2a28);
  font-weight: 600;
  /* Halo so the label stays readable over the marker lines */
  paint-order: stroke;
  stroke: var(--gc-color-surface, #ffffff);
  stroke-width: 4px;
  stroke-linejoin: round;
}
.timeline-value--muted {
  fill: var(--gc-color-muted, #60716d);
  font-weight: 400;
}
.timeline-range {
  fill: var(--gc-color-text, #1f2a28);
  fill-opacity: 0.55;
}
.timeline-whisker {
  stroke: var(--gc-color-muted, #60716d);
  stroke-width: 1.5;
}
</style>

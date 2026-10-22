// Past SOI deployments, summarised for the planner (built by scripts/build_planner_data.R)
import history from "../data/planner_history.json";

export const historyInfo = { generated: history.generated, source: history.source };

// Weight mixture used to infer the battery class of orders without a named cell
export const batteryMixture = history.battery_mixture;

export const orders = history.orders.map((o, idx) => ({ ...o, idx, tags: [], downloads: [] }));

export const tags = history.tags.order.map((orderIdx, idx) => ({
  idx,
  order: orders[orderIdx],
  type: history.tags.type[idx],
  hw: history.tags.hw[idx],
  battery: history.tags.battery[idx],
  batterySource: history.tags.battery_source[idx],
  harness: history.tags.harness[idx],
  lwl: history.tags.lwl[idx],
  lwlLength: history.tags.lwl_length[idx],
  weight: history.tags.weight[idx],
  hasData: history.tags.has_data[idx],
  downloads: [],
}));

export const downloads = history.downloads.tag.map((tagIdx, idx) => ({
  idx,
  tag: tags[tagIdx],
  hw: history.downloads.hw[idx],
  mem: history.downloads.mem[idx],
  days: history.downloads.days[idx],
  endType: history.downloads.end_type[idx],
  batLow: history.downloads.batlow[idx],
  memErr: history.downloads.memerr[idx],
  sensors: [],
}));

export const sensorRecords = history.sensors.download.map((dlIdx, idx) => ({
  download: downloads[dlIdx],
  sensor: history.sensors.sensor[idx],
  interval: history.sensors.interval[idx],
  days: history.sensors.days[idx],
  predMemDays: history.sensors.pred_mem_days[idx],
  early: history.sensors.early[idx],
}));

for (const t of tags) t.order.tags.push(t);
for (const d of downloads) {
  d.tag.downloads.push(d);
  d.tag.order.downloads.push(d);
}
for (const s of sensorRecords) s.download.sensors.push(s);

export const END_TYPES = {
  A: "Still recording at read-back",
  B: "Stopped before read-back",
  other: "No read-back time",
};

export function quantile(values, q) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function summarise(values) {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return { n: 0 };
  return {
    n: v.length,
    min: Math.min(...v),
    q10: quantile(v, 0.1),
    q25: quantile(v, 0.25),
    median: quantile(v, 0.5),
    q75: quantile(v, 0.75),
    q90: quantile(v, 0.9),
    max: Math.max(...v),
  };
}

// Weight of past tags with this type, battery, hardware, harness and light stalk,
// dropping criteria until at least 20 tags match. `values` are those tags' weights;
// `context` the weights of all tags matching the same criteria, whatever the battery.
export function weightStats({ type, battery, hw, harness, lwl, lwlLength }) {
  const sameStalk = (t) => t.lwl === lwl && (!lwl || !lwlLength || t.lwlLength === lwlLength);
  const steps = [
    { label: "same hardware, harness and light stalk", f: (t) => (!hw || t.hw === hw) && t.harness === harness && sameStalk(t) },
    { label: "same harness and light stalk", f: (t) => t.harness === harness && sameStalk(t) },
    { label: "same harness and light stalk (any length)", f: (t) => t.harness === harness && t.lwl === lwl },
    { label: "same harness", f: (t) => t.harness === harness },
    { label: "any harness", f: () => true },
  ];
  const base = tags.filter((t) => t.type === type && Number.isFinite(t.weight));
  for (const step of steps) {
    const context = base.filter(step.f);
    const sel = context.filter((t) => t.battery === battery);
    if (sel.length >= 20 || step === steps.at(-1)) {
      return {
        ...summarise(sel.map((t) => t.weight)),
        basis: step.label,
        values: sel.map((t) => t.weight),
        context: context.map((t) => t.weight),
      };
    }
  }
  return { n: 0 };
}

// How long past tags with this type, hardware and battery recorded
export function lifetimeStats({ type, hw, battery }) {
  const sel = downloads.filter(
    (d) => d.tag.type === type && (!hw || d.hw === hw) && (!battery || d.tag.battery === battery) && Number.isFinite(d.days)
  );
  // Records shorter than this are tests or tags that failed at the start
  const minDays = 20;
  const stoppedEarly = sel.filter((d) => d.endType === "B" && d.days >= minDays);
  const stillLogging = sel.filter((d) => d.endType === "A");
  return {
    n: sel.length,
    stoppedEarly: summarise(stoppedEarly.map((d) => d.days)),
    stillLogging: summarise(stillLogging.map((d) => d.days)),
    short: sel.filter((d) => d.days < minDays).length,
    minDays,
    all: sel,
  };
}

// Past records of one sensor at one interval on the same type and hardware
export function sensorStats({ type, hw, sensor, interval }) {
  const sel = sensorRecords.filter(
    (s) => s.sensor === sensor && s.interval === interval && s.download.tag.type === type && (!hw || s.download.hw === hw)
  );
  const early = sel.filter((s) => s.early);
  return {
    n: sel.length,
    nEarly: early.length,
    earlyDays: summarise(early.map((s) => s.days)),
    days: summarise(sel.map((s) => s.days)),
  };
}

export function genusOf(species) {
  return (species || "").split(" ")[0];
}

// Past orders for this species, else the same genus
export function relatedOrders(scientificName) {
  if (!scientificName) return { same: [], genus: [] };
  const genus = genusOf(scientificName);
  return {
    same: orders.filter((o) => o.species === scientificName),
    genus: orders.filter((o) => o.species !== scientificName && genusOf(o.species) === genus),
  };
}

export function orderSummary(order) {
  const w = summarise(order.tags.map((t) => t.weight));
  const days = summarise(order.downloads.map((d) => d.days));
  const batteries = {};
  for (const t of order.tags) if (t.battery) batteries[t.battery] = (batteries[t.battery] || 0) + 1;
  const ends = {};
  for (const d of order.downloads) ends[d.endType] = (ends[d.endType] || 0) + 1;
  return { weight: w, days, batteries, ends };
}

// Number of past tags per battery class for a tag type and hardware
export function batteryCounts(type, hw) {
  const counts = {};
  for (const t of tags) {
    if (t.type === type && (!hw || t.hw === hw) && t.battery) counts[t.battery] = (counts[t.battery] || 0) + 1;
  }
  return counts;
}

// Main battery class of an order: the class of most of its tags
function mainBattery(order) {
  const counts = {};
  for (const t of order.tags) if (t.battery) counts[t.battery] = (counts[t.battery] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// Intervals past orders of a tag type (and battery) used for one sensor (0 = off), most used first
export function intervalUsage(type, sensor, battery) {
  const sel = orders.filter((o) => o.type === type && (!battery || mainBattery(o) === battery));
  const counts = new Map();
  for (const o of sel) {
    const v = o[sensor] > 0 ? o[sensor] : 0;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts]
    .map(([interval, n]) => ({ interval, n, share: n / sel.length }))
    .sort((a, b) => b.n - a.n);
}

// Share of past tags of a type (and battery) with each light stalk length (0 = no stalk)
export function stalkUsage(type, battery) {
  const sel = tags.filter((t) => t.type === type && (!battery || t.battery === battery) && t.lwl !== null);
  const counts = {};
  for (const t of sel) {
    const k = t.lwl ? t.lwlLength ?? "unknown" : 0;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / sel.length]));
}

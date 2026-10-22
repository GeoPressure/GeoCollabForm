// Theoretical battery and memory model for SOI geolocators.
// Energy and memory figures come from "SimulationGDL3pam v2.4_StromSpeicher.xlsx";
// memory sizes are the DataMemorySize reported by the loggers.

// In the order most past deployments use them
export const SENSORS = [
  { key: "light", label: "Light", bytes: 2, energyAh: 3e-9, durationH: 1.2 / 3600 },
  { key: "pressure", label: "Pressure", bytes: 2, energyAh: 4e-9, durationH: 0.6 / 3600 },
  { key: "acc", label: "Activity", bytes: 2, energyAh: 53e-9, durationH: 2.3 / 3600 },
  { key: "mag", label: "Magnetic+acceleration (3-axis)", short: "Magnetic+acc.", bytes: 13, energyAh: 54e-9, durationH: 1.3 / 3600 },
  { key: "airT", label: "Temperature", bytes: 1, energyAh: 1e-9, durationH: 0.153 / 3600 },
  { key: "bodyT", label: "Body temperature", bytes: 1, energyAh: 1e-9, durationH: 0.153 / 3600 },
];

export const SENSOR_BY_KEY = Object.fromEntries(SENSORS.map((s) => [s.key, s]));

export const TAG_TYPES = {
  GDL3pam: {
    key: "GDL3pam",
    label: "GDL3pam (multi-sensor)",
    sensors: ["light", "pressure", "acc", "mag", "airT", "bodyT"],
    memoryBytes: { "v2.4": 4225024, "v2.3": 1083392 },
    defaultHw: "v2.4",
    // Lightest first; classes without past tags are hidden in the planner
    batteries: ["2S", "S", "M", "L"],
    defaults: { light: 5, pressure: 30, acc: 5, mag: null, airT: null, bodyT: null },
  },
  GDL2lp: {
    key: "GDL2lp",
    label: "GDL2lp (light + pressure, lightweight)",
    sensors: ["light", "pressure"],
    // Reported as 48,128 bytes, but the firmware compresses: 5 min light and 30 min
    // pressure filled less than this in 400+ days. Memory is taken from past tags only.
    memoryBytes: {},
    defaultHw: "v1.0",
    batteries: ["LP"],
    defaults: { light: 5, pressure: 30 },
  },
};

// Battery classes, with the cell types used in production
export const BATTERIES = {
  S: { key: "S", label: "Small", cell: "CR1025", mAh: 30, cellWeightG: 0.6 },
  M: { key: "M", label: "Medium", cell: "CR1220", mAh: 38, cellWeightG: 0.8 },
  L: { key: "L", label: "Large", cell: "CR1225", mAh: 48, cellWeightG: 0.9 },
  "2S": { key: "2S", label: "Double small", cell: "2× Renata 337", mAh: 8, cellWeightG: null },
  LP: { key: "LP", label: "GDL2lp battery", cell: "built in", mAh: null, cellWeightG: null },
};

const SLEEP_CURRENT_A = { low: 1.8e-6, high: 2e-6 };

function activeSensors(intervals) {
  return SENSORS.filter((s) => Number.isFinite(intervals[s.key]) && intervals[s.key] > 0);
}

// Battery life in days after logging starts, as in the spreadsheet: measurement energy
// plus sleep current, minus the sleep drain during standby before logging starts.
export function batteryLifeDays(intervals, capacityMAh, standbyDays = 0) {
  if (!Number.isFinite(capacityMAh) || capacityMAh <= 0) return null;
  let measureAhPerH = 0;
  let measureHoursPerH = 0;
  for (const s of activeSensors(intervals)) {
    const perHour = 60 / intervals[s.key];
    measureAhPerH += perHour * s.energyAh;
    measureHoursPerH += perHour * s.durationH;
  }
  const sleepHoursPerH = 1 - measureHoursPerH;
  const life = (sleepCurrentA) => {
    const sleepAhPerH = sleepHoursPerH * sleepCurrentA;
    const remainingAh = capacityMAh / 1000 - Math.max(0, standbyDays) * 24 * sleepAhPerH;
    return Math.max(0, remainingAh / (measureAhPerH + sleepAhPerH) / 24);
  };
  const sleepShare = (sleepHoursPerH * SLEEP_CURRENT_A.high) / (measureAhPerH + sleepHoursPerH * SLEEP_CURRENT_A.high);
  return { low: life(SLEEP_CURRENT_A.high), high: life(SLEEP_CURRENT_A.low), sleepShare };
}

// Days until each sensor's memory is full. Memory is split between sensors in proportion
// to their data rate; each sensor stops recording when its share is full.
export function memoryFullDays(intervals, memoryBytes) {
  if (!Number.isFinite(memoryBytes) || memoryBytes <= 0) return null;
  const sensors = activeSensors(intervals);
  const rate = Object.fromEntries(sensors.map((s) => [s.key, s.bytes / intervals[s.key]]));
  const totalRate = Object.values(rate).reduce((a, b) => a + b, 0);
  const pages = memoryBytes / 256;
  const out = {};
  for (const s of sensors) {
    const usable = s.key === "mag" ? 208 : 224;
    out[s.key] = (Math.round((pages * rate[s.key]) / totalRate) * usable) / rate[s.key] / 1440;
  }
  return out;
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

// Production settings: one base interval (1-59 min) and a factor (1-255) per sensor
export function productionSettings(intervals) {
  const values = activeSensors(intervals).map((s) => intervals[s.key]);
  const errors = [];
  if (values.length === 0) return { base: null, factors: {}, errors: ["No sensor is switched on."] };
  if (values.some((v) => !Number.isInteger(v))) {
    errors.push("Intervals must be whole minutes.");
    return { base: null, factors: {}, errors };
  }
  const common = values.reduce(gcd);
  let base = Math.min(common, 59);
  while (common % base !== 0) base -= 1;
  const factors = {};
  for (const s of SENSORS) {
    const v = intervals[s.key];
    factors[s.key] = Number.isFinite(v) && v > 0 ? v / base : 0;
    if (factors[s.key] > 255) {
      errors.push(`${s.label}: ${v} min is too long for a base interval of ${base} min (at most ${255 * base} min).`);
    }
  }
  return { base, factors, errors };
}

export function formatInterval(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return "off";
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

// Durations as "1y 4m 3d" (a year is 365 days, a month a twelfth of it)
export function formatDays(days) {
  if (!Number.isFinite(days)) return "–";
  const month = 365 / 12;
  const total = Math.round(days);
  const y = Math.floor(total / 365);
  const m = Math.floor((total - y * 365) / month);
  const d = Math.round(total - y * 365 - m * month);
  const parts = [y ? `${y}y` : "", m ? `${m}m` : "", d || (!y && !m) ? `${d}d` : ""];
  return parts.filter(Boolean).join(" ");
}

export function formatDayRange(lo, hi) {
  return `${formatDays(lo)}–${formatDays(hi)}`;
}

export function agreementText(typeKey, intervals, batteryKey) {
  const type = TAG_TYPES[typeKey];
  const b = BATTERIES[batteryKey];
  const parts = [];
  for (const key of type.sensors) {
    const v = intervals[key];
    if (!(v > 0)) continue;
    const [n, unit] = formatInterval(v).split(" ");
    const every = n === "1" ? { min: "minute", h: "hour", d: "day" }[unit] : `${n} ${{ min: "minutes", h: "hours", d: "days" }[unit]}`;
    parts.push(`${SENSOR_BY_KEY[key].label.toLowerCase()} every ${every}`);
  }
  if (parts.length === 0) return "";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const tag = b && b.mAh ? `${typeKey} with a ${b.label.toLowerCase()} battery, ${b.cell}` : typeKey;
  return `The geolocators (${tag}) will record ${list}.`;
}

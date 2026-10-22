<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import joinedSpeciesCsv from "../../data/avilist_soi_avonet_joined.csv?raw";
import { parseSpeciesRecordsFromJoinedCsv } from "../../lib/speciesCatalog";
import {
  BATTERIES,
  SENSOR_BY_KEY,
  TAG_TYPES,
  agreementText,
  batteryLifeDays,
  formatDayRange,
  formatDays,
  formatInterval,
  memoryFullDays,
  productionSettings,
} from "../../lib/loggerModel";
import {
  batteryCounts,
  batteryMixture,
  intervalUsage,
  lifetimeStats,
  stalkUsage,
  orderSummary,
  relatedOrders,
  sensorStats,
  summarise,
  weightStats,
} from "../../lib/plannerHistory";
import InfoNote from "./InfoNote.vue";
import TimelineChart from "./TimelineChart.vue";
import WeightHistogram from "./WeightHistogram.vue";

const props = defineProps({ startingPoint: { type: Object, default: null } });

const speciesRecords = parseSpeciesRecordsFromJoinedCsv(joinedSpeciesCsv);
const speciesById = new Map(speciesRecords.map((s) => [s.avibase_id, s]));
const speciesByName = new Map(speciesRecords.map((s) => [s.scientific_name, s]));

const SHORT_LABEL = { light: "L", pressure: "P", acc: "A", mag: "M", airT: "T", bodyT: "B" };

const plan = reactive({
  speciesId: null,
  bodyMass: null,
  type: "GDL3pam",
  battery: "M",
  harness: "leg",
  lwl: 1,
  lwlLength: 7,
  // Interval in minutes per sensor; 0 switches the sensor off
  intervals: defaultIntervals("GDL3pam"),
  // Advanced settings
  hw: "v2.4",
  standbyDays: 30,
});

function defaultIntervals(t) {
  return Object.fromEntries(TAG_TYPES[t].sensors.map((k) => [k, TAG_TYPES[t].defaults[k] || 0]));
}

const showAdvanced = ref(false);

// Light stalk: none, or one of the lengths used in past tags (7 mm is the standard)
const stalkOptions = [
  { value: 0, label: "None", title: "No light stalk" },
  ...[5, 7, 10, 12].map((mm) => ({ value: mm, label: `${mm} mm`, title: mm === 7 ? "Standard length" : `${mm} mm stalk` })),
];
const stalkShares = computed(() => stalkUsage(plan.type, plan.battery));
function stalkShare(mm) {
  const share = stalkShares.value[mm] || 0;
  return share >= 0.005 ? `${Math.round(share * 100)}%` : share > 0 ? "<1%" : "–";
}
const stalk = computed({
  get: () => (plan.lwl ? plan.lwlLength : 0),
  set: (v) => {
    plan.lwl = v > 0 ? 1 : 0;
    if (v > 0) plan.lwlLength = v;
  },
});
const speciesSearch = ref("");
const species = computed(() => speciesById.get(plan.speciesId) || null);
const speciesOptions = computed(() =>
  speciesSearch.value.trim().length >= 1 ? speciesRecords : species.value ? [species.value] : []
);
function speciesFilter(_value, query, item) {
  const q = query.toLowerCase().trim();
  if (q.length < 1 || !item) return false;
  return item.raw.common_name.toLowerCase().includes(q) || item.raw.scientific_name.toLowerCase().includes(q);
}
watch(species, (s) => {
  plan.bodyMass = s?.body_mass_g ?? null;
});

const type = computed(() => TAG_TYPES[plan.type]);
const hw = computed(() => (plan.type === "GDL3pam" ? plan.hw : null));

watch(
  () => plan.type,
  (t, old) => {
    if (t === old) return;
    plan.intervals = defaultIntervals(t);
    if (!TAG_TYPES[t].batteries.includes(plan.battery)) plan.battery = TAG_TYPES[t].batteries[0];
  }
);

// Batteries used with this tag and hardware in past deployments
const batteryChoices = computed(() => {
  const counts = batteryCounts(plan.type, hw.value);
  return type.value.batteries
    .filter((b) => counts[b] > 0 || type.value.batteries.length === 1)
    .map((b) => ({ ...BATTERIES[b], n: counts[b] || 0 }));
});
watch(batteryChoices, (choices) => {
  if (choices.length && !choices.some((b) => b.key === plan.battery)) plan.battery = choices[0].key;
});

// How often past orders of this tag type used each interval, per sensor
const usage = computed(() =>
  Object.fromEntries(type.value.sensors.map((k) => [k, intervalUsage(plan.type, k, plan.battery)]))
);
const usageOrders = computed(() => Object.values(usage.value)[0]?.reduce((a, u) => a + u.n, 0) ?? 0);

// Intervals are whole minutes, 0 or more (the arrows step by 5, but any minute can be typed)
function cleanInterval(key) {
  const v = Number(plan.intervals[key]);
  plan.intervals[key] = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

// Copy a past order's tag, battery, harness and intervals into the plan
function applyOrder(o) {
  plan.type = o.type;
  if (o.type === "GDL3pam") plan.hw = ["v2.3", "v2.4"].includes(o.hw) ? o.hw : "v2.4";
  const s = speciesByName.get(o.species);
  if (s) plan.speciesId = s.avibase_id;
  const summary = orderSummary(o);
  const battery = Object.entries(summary.batteries).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (battery) plan.battery = battery;
  if (o.harness) plan.harness = o.harness;
  // Wait for the type watcher to reset the intervals before applying the order's
  nextTick(() => {
    for (const key of TAG_TYPES[o.type].sensors) plan.intervals[key] = o[key] > 0 ? o[key] : 0;
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

watch(
  () => props.startingPoint,
  (o) => {
    if (o) applyOrder(o);
  }
);

// ---- Results ---------------------------------------------------------------

const activeIntervals = computed(() => {
  const iv = {};
  for (const key of type.value.sensors) if (plan.intervals[key] > 0) iv[key] = plan.intervals[key];
  return iv;
});

const weight = computed(() =>
  weightStats({ type: plan.type, battery: plan.battery, hw: hw.value, harness: plan.harness, lwl: plan.lwl, lwlLength: plan.lwlLength })
);
const weightPct = computed(() =>
  weight.value.n && plan.bodyMass > 0 ? (weight.value.median / plan.bodyMass) * 100 : null
);
const weightTone = computed(() => {
  if (weightPct.value === null) return "warning";
  if (weightPct.value > 5) return "error";
  if (weightPct.value > 3) return "warning";
  return "success";
});

const battery = computed(() => batteryLifeDays(activeIntervals.value, BATTERIES[plan.battery].mAh, plan.standbyDays));
const memory = computed(() => memoryFullDays(activeIntervals.value, type.value.memoryBytes[hw.value]));
const lifetime = computed(() => lifetimeStats({ type: plan.type, hw: hw.value, battery: plan.battery }));
const sensorHistory = computed(() =>
  Object.entries(activeIntervals.value).map(([key, interval]) => ({
    key,
    interval,
    model: memory.value?.[key] ?? null,
    past: sensorStats({ type: plan.type, hw: hw.value, sensor: key, interval }),
  }))
);
const production = computed(() => productionSettings(activeIntervals.value));

// One chart per source, on a shared axis: battery model, memory model, past tags
const batteryRows = computed(() =>
  battery.value
    ? [
        {
          label: `${BATTERIES[plan.battery].label} battery`,
          value: battery.value.low,
          hi: battery.value.high,
          tone: "model",
          detail: formatDayRange(battery.value.low, battery.value.high),
        },
      ]
    : []
);

// Memory is shared in proportion to each sensor's data rate, so all sensors fill up
// together (within a day or so, from rounding to whole pages): one row, first to fill
const memoryRows = computed(() => {
  const days = sensorHistory.value.map((s) => s.model).filter(Number.isFinite);
  if (!days.length) return [];
  return [
    {
      label: "All sensors",
      value: Math.min(...days),
      tone: "model",
      detail: sensorHistory.value
        .filter((s) => Number.isFinite(s.model))
        .map((s) => `${SENSOR_BY_KEY[s.key].short || SENSOR_BY_KEY[s.key].label} ${formatDays(s.model)}`)
        .join(", "),
    },
  ];
});

const pastRows = computed(() => {
  const early = lifetime.value.stoppedEarly;
  const still = lifetime.value.stillLogging;
  const rows = [];
  if (still.n >= 3) {
    rows.push({
      label: `Still on (${still.n} tags)`,
      q: [still.q25, still.median, still.q75],
      tone: "past",
      detail: `${still.n} tags, median ${formatDays(still.median)}, longest ${formatDays(still.max)}`,
    });
  }
  if (early.n >= 3) {
    rows.push({
      label: `Stopped early (${early.n})`,
      q: [early.q25, early.median, early.q75],
      tone: "past",
      detail: `${early.n} tags, median ${formatDays(early.median)} (middle half ${formatDayRange(early.q25, early.q75)})`,
    });
  }
  if (rows.length === 0 && lifetime.value.n >= 1) {
    const all = summarise(lifetime.value.all.map((d) => d.days));
    rows.push({
      label: "Recorded",
      q: [all.q25, all.median, all.q75],
      tone: "past",
      detail: `${all.n} tags, median ${formatDays(all.median)} (range ${formatDayRange(all.min, all.max)})`,
    });
  }
  return rows;
});

// Axis long enough for the values, at least 1.25 years, at most about 3 years
// Axis long enough for the values (at least 1.25 years). Battery and past tags share
// one axis so they can be compared; memory, often much longer, has its own.
function axisEnd(values) {
  const end = Math.max(456, ...values.filter(Number.isFinite).map((v) => v * 1.08));
  return Math.ceil(end / 91.25) * 91.25;
}
const maxDay = computed(() => axisEnd([battery.value?.high, ...pastRows.value.map((r) => r.q[2])]));
const memoryMaxDay = computed(() => axisEnd(memoryRows.value.map((r) => r.value)));
const markersFor = (end) => [
  { day: 365, label: "1 year" },
  ...(end > 760 ? [{ day: 730, label: "2 years" }] : []),
];
const markers = computed(() => markersFor(maxDay.value));
const memoryMarkers = computed(() => markersFor(memoryMaxDay.value));

const memoryKB = computed(() => {
  const bytes = type.value.memoryBytes[hw.value];
  return Number.isFinite(bytes) ? `${(bytes / 1e6).toFixed(1)} MB` : null;
});

const warnings = computed(() => {
  const w = [];
  for (const e of production.value.errors) w.push({ tone: "error", text: e });
  if (plan.type === "GDL2lp")
    w.push({ tone: "info", text: "The GDL2lp has no battery or memory model yet. Only a few have been read back; see past tags." });
  return w;
});

const related = computed(() => relatedOrders(species.value?.scientific_name));
const relatedRows = computed(() =>
  [...related.value.same.map((o) => ({ o, rel: "same species" })), ...related.value.genus.map((o) => ({ o, rel: "same genus" }))].map(
    ({ o, rel }) => ({ o, rel, s: orderSummary(o) })
  )
);

const agreement = computed(() => agreementText(plan.type, activeIntervals.value, plan.battery));

const copied = ref(false);
async function copyAgreement() {
  await navigator.clipboard.writeText(agreement.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

const fmt = (v, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits) : "–");
</script>


<template>
  <!-- Settings: everything the user changes, in one box -->
  <section class="planner-settings" aria-labelledby="planner-settings-title">
    <header class="planner-settings-header">
      <div>
        <h2 id="planner-settings-title" class="planner-settings-title">
          <v-icon icon="mdi-tune-variant" size="20" class="mr-1" />Your settings
        </h2>
        <p class="planner-settings-subtitle">Change these and the results below update.</p>
      </div>
      <v-btn
        size="small"
        variant="text"
        color="primary"
        :prepend-icon="showAdvanced ? 'mdi-chevron-up' : 'mdi-cog-outline'"
        @click="showAdvanced = !showAdvanced"
      >
        Advanced
      </v-btn>
    </header>

    <div class="planner-setup">
      <section class="planner-step">
        <h3 class="planner-step-title"><span class="planner-step-number">1</span>Bird</h3>
        <v-autocomplete
          v-model="plan.speciesId"
          v-model:search="speciesSearch"
          label="Species"
          :items="speciesOptions"
          :item-title="(s) => (s ? `${s.common_name} (${s.scientific_name})` : '')"
          item-value="avibase_id"
          :custom-filter="speciesFilter"
          :hide-no-data="speciesSearch.trim().length < 1"
          no-data-text="No species found."
          clearable
          density="comfortable"
          bg-color="surface"
          hide-details
        />
        <a
          v-if="species"
          class="planner-bow-link"
          :href="species.birds_of_the_world_url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <v-icon icon="mdi-open-in-new" size="13" />{{ species.common_name }} on Birds of the World
        </a>
        <div class="planner-or" aria-hidden="true">or</div>
        <v-text-field
          v-model.number="plan.bodyMass"
          label="Bird weight"
          suffix="g"
          type="number"
          density="comfortable"
          bg-color="surface"
          :hint="species ? `${species.common_name} from AVONET; change it for your population` : ''"
          persistent-hint
        />
      </section>

      <section class="planner-step">
        <h3 class="planner-step-title"><span class="planner-step-number">2</span>Geolocator and battery</h3>
        <v-btn-toggle v-model="plan.type" mandatory color="primary" variant="outlined" divided density="comfortable" class="mb-3 planner-toggle">
          <v-btn value="GDL3pam">GDL3pam</v-btn>
          <v-btn value="GDL2lp">GDL2lp</v-btn>
        </v-btn-toggle>
        <div v-if="batteryChoices.length > 1" class="planner-battery-choices mb-3" role="radiogroup" aria-label="Battery">
          <button
            v-for="b in batteryChoices"
            :key="b.key"
            type="button"
            role="radio"
            :aria-checked="plan.battery === b.key"
            :class="['planner-battery', { 'planner-battery--active': plan.battery === b.key }]"
            :title="`${b.n} past ${plan.type}${hw ? ` ${hw}` : ''} tags with this battery`"
            @click="plan.battery = b.key"
          >
            <span class="planner-battery-label">{{ b.label }}</span>
            <span class="planner-battery-cell">{{ b.cell }}</span>
            <span class="planner-battery-cell">{{ b.mAh }} mAh</span>
          </button>
        </div>
        <div v-else class="planner-hint mb-3">Battery: {{ BATTERIES[plan.battery].cell }}</div>
        <v-select
          v-model="plan.harness"
          label="Harness"
          :items="[{ title: 'Leg-loop', value: 'leg' }, { title: 'Breast', value: 'breast' }, { title: 'None', value: 'none' }]"
          density="compact"
          bg-color="surface"
          hide-details
          class="mb-1"
        />
        <div class="planner-stalk">
          <span class="planner-stalk-label">Light stalk</span>
          <v-btn-toggle v-model="stalk" mandatory color="primary" variant="outlined" divided density="compact" class="planner-toggle">
            <v-btn v-for="o in stalkOptions" :key="o.value" :value="o.value" :title="o.title" size="small" class="planner-stalk-btn">
              <span class="planner-stalk-btn-label">
                {{ o.label }}
                <span class="planner-stalk-share">{{ stalkShare(o.value) }}</span>
              </span>
            </v-btn>
          </v-btn-toggle>
        </div>
      </section>

      <section class="planner-step">
        <h3 class="planner-step-title"><span class="planner-step-number">3</span>Recording interval</h3>
        <div class="planner-sensor-list">
          <div v-for="key in type.sensors" :key="key" :class="['planner-sensor-item', { 'planner-sensor-row--off': !(plan.intervals[key] > 0) }]">
            <label class="planner-sensor-row">
              <span class="planner-sensor-label">{{ SENSOR_BY_KEY[key].label }}</span>
              <span class="planner-sensor-field">
                <input
                  v-model.number="plan.intervals[key]"
                  type="number"
                  min="0"
                  step="5"
                  inputmode="numeric"
                  class="planner-sensor-input"
                  @change="cleanInterval(key)"
                />
                <span class="planner-sensor-unit">{{ plan.intervals[key] > 0 ? "min" : "off" }}</span>
              </span>
            </label>
          </div>
        </div>
      </section>
    </div>

    <div v-if="showAdvanced" class="planner-advanced-row">
      <v-select
        v-if="plan.type === 'GDL3pam'"
        v-model="plan.hw"
        label="Hardware"
        :items="[{ title: 'v2.4 (current)', value: 'v2.4' }, { title: 'v2.3', value: 'v2.3' }]"
        density="compact"
        bg-color="surface"
        hide-details
      />
      <v-text-field
        v-model.number="plan.standbyDays"
        label="Standby before logging"
        suffix="days"
        type="number"
        min="0"
        density="compact"
        bg-color="surface"
        hint="Battery connected until logging starts"
        persistent-hint
      />
    </div>
  </section>

  <div v-if="warnings.length" class="planner-warnings">
    <v-alert v-for="w in warnings" :key="w.text" :type="w.tone" density="compact" class="mb-2">{{ w.text }}</v-alert>
  </div>

  <!-- Results -->
  <div class="planner-results-grid mt-3">
      <v-sheet border rounded="lg" class="pa-3">
        <div class="planner-head">
          <h2 class="planner-section-title">Is the logger light enough?</h2>
          <InfoNote label="About this figure">
            Weight of {{ weight.n }} past {{ plan.type }} tags with a {{ BATTERIES[plan.battery].label.toLowerCase() }} battery and
            the {{ weight.basis }} (blue), among all {{ weight.context.length }} tags with the {{ weight.basis }}, whatever their
            battery (grey). The logger weight above is their median. When fewer than 20 tags match, the hardware, then the
            stalk length, then the light stalk, then the harness is dropped from the match.
            <br />
            The battery is not recorded per tag. It comes from the cell named in the order remarks (CR1225 large, CR1220
            medium, two 1.5 V cells double small), or else from the order's median weight: a Gaussian mixture fitted to all
            v2.x orders with a harness and light stalk finds groups around
            {{ batteryMixture.mean.map((m) => `${m.toFixed(2)} g`).join(", ") }}, and an order gets a class only when it is at
            least {{ Math.round(batteryMixture.min_posterior * 100) }}% likely. Orders in between (tubes, glue and harness add a
            variable weight), older hardware and tags without harness or light stalk stay unknown and are only in grey.
          </InfoNote>
        </div>

        <div :class="`planner-weight-line planner-weight-line--${weightTone}`">
          <span class="planner-weight-label">Logger weight</span>
          <span class="planner-logger-weight">{{ weight.n ? `${fmt(weight.median, 2)} g` : "–" }}</span>
          <span v-if="weightPct !== null" class="planner-weight-pct">{{ weightPct.toFixed(1) }}%</span>
          <span class="planner-hint">
            <template v-if="!weight.n">no past tags with this battery</template>
            <template v-else-if="plan.bodyMass > 0">of a {{ fmt(plan.bodyMass, plan.bodyMass > 100 ? 0 : 1) }} g bird</template>
            <template v-else>choose a species or enter a bird weight</template>
          </span>
        </div>

        <WeightHistogram
          v-if="weight.context?.length"
          class="mt-1"
          :all="weight.context"
          :selected="weight.values"
          :body-mass="plan.bodyMass"
          :median="weight.n ? weight.median : null"
          :selected-label="BATTERIES[plan.battery].label.toLowerCase()"
        />
      </v-sheet>

      <v-sheet border rounded="lg" class="pa-3">
        <div class="planner-head">
          <h2 class="planner-section-title">Intervals used in past orders</h2>
          <InfoNote label="About this figure">
            Share of the {{ usageOrders }} past {{ plan.type }} orders with a {{ BATTERIES[plan.battery].label.toLowerCase() }}
            battery recording each sensor at each interval, whatever the
            species or outcome, from off (grey) to the longest interval; narrow segments are rare settings (hover for the number of orders). Your current setting is
            outlined. Settings come from the logger files when they were read back, else from the production database.
          </InfoNote>
        </div>
        <p v-if="!usageOrders" class="planner-hint mb-0">No past orders with this battery.</p>
        <div v-for="key in type.sensors" :key="key" class="planner-usage-row">
          <div class="planner-usage-label">{{ SENSOR_BY_KEY[key].short || SENSOR_BY_KEY[key].label }}</div>
          <div class="planner-usage-bars">
            <span
              v-for="u in [...usage[key]].sort((a, b) => a.interval - b.interval)"
              :key="u.interval"
              :class="['planner-usage-bar', { 'planner-usage-bar--active': (plan.intervals[key] || 0) === u.interval, 'planner-usage-bar--off': !u.interval }]"
              :style="{ flexGrow: u.n }"
              :title="`${u.interval ? formatInterval(u.interval) : 'off'}: ${u.n} orders (${Math.round(u.share * 100)}%)`"
            >
              <span v-if="u.share >= 0.07">{{ u.interval ? formatInterval(u.interval) : "off" }}</span>
            </span>
          </div>
        </div>
      </v-sheet>

    <v-sheet border rounded="lg" class="pa-3 planner-span-all">
      <h2 class="planner-section-title">How long will it record?</h2>

      <div class="planner-limit">
        <div class="planner-head">
          <h3 class="planner-limit-title"><v-icon icon="mdi-battery-60" size="18" class="mr-1" />Battery (model)</h3>
          <InfoNote>
            <template v-if="battery">
              The {{ BATTERIES[plan.battery].cell }} holds {{ BATTERIES[plan.battery].mAh }} mAh. Each measurement uses a fixed
              charge (light 3, pressure 4, activity 53, magnetic+acceleration 54, temperature 1 nAh), and the tag draws 1.8–2 µA while it
              sleeps between measurements, which gives the range (± in the label, thin dark line on the bar); the bar goes to its middle. The {{ plan.standbyDays }} days of standby before
              logging are subtracted. With these intervals, sleeping uses {{ Math.round(battery.sleepShare * 100) }}% of the energy.
            </template>
            <template v-else>No battery model for this tag yet; see past tags.</template>
          </InfoNote>
        </div>
        <TimelineChart v-if="batteryRows.length" :rows="batteryRows" :markers="markers" :max-day="maxDay" />
      </div>

      <div class="planner-limit">
        <div class="planner-head">
          <h3 class="planner-limit-title"><v-icon icon="mdi-history" size="18" class="mr-1" />Past tags</h3>
          <InfoNote>
            From the raw data of {{ lifetime.n }} read-back {{ plan.type }}{{ hw ? ` ${hw}` : "" }} tags<template
              v-if="plan.battery !== 'LP'"> with a {{ BATTERIES[plan.battery].label.toLowerCase() }} battery</template>, whatever
            their intervals. <strong>Still on</strong>: at least one sensor was still recording when the tag was read
            back, so the battery lasts at least this long. <strong>Stopped early</strong>: the last sensor stopped before read-back
            (battery, full memory or failure). Box: middle half of tags; line: median.
            <template v-if="lifetime.short">
              {{ lifetime.short }} records shorter than {{ lifetime.minDays }} days (tests or failures at the start) are left out.
            </template>
          </InfoNote>
        </div>
        <TimelineChart v-if="pastRows.length" :rows="pastRows" :markers="markers" :max-day="maxDay" />
      </div>
      <div class="planner-limit">
        <div class="planner-head">
          <h3 class="planner-limit-title"><v-icon icon="mdi-memory" size="18" class="mr-1" />Memory (model)</h3>
          <InfoNote>
            <template v-if="memoryKB">
              The {{ memoryKB }} memory ({{ plan.type }} {{ hw }}) is split in 256-byte pages, shared between sensors in proportion to
              the data each writes (light, pressure and activity 2 bytes per measurement, magnetic+acceleration 13, temperature 1). Each
              sensor stops when its share is full, so all sensors fill up at about the same time and are shown as one bar (hover for each sensor).
            </template>
            <template v-else>No memory model for this tag yet; see past tags.</template>
          </InfoNote>
        </div>
        <TimelineChart v-if="memoryRows.length" :rows="memoryRows" :markers="memoryMarkers" :max-day="memoryMaxDay" />
      </div>

    </v-sheet>
  </div>

  <v-sheet v-if="species" border rounded="lg" class="pa-4 mt-3">
    <div class="planner-head">
      <h2 class="planner-section-title">Past SOI deployments of {{ species.common_name }} and its genus</h2>
      <InfoNote v-if="relatedRows.length" label="Legend">
        L = light, P = pressure, A = activity, M = magnetic+acceleration (3-axis), T = temperature, B = body temperature. Days recorded: median
        over read-back tags. The arrow copies an order's settings into your plan.
      </InfoNote>
    </div>
    <p v-if="relatedRows.length === 0" class="planner-hint mb-0">None yet.</p>
    <v-table v-else density="compact">
      <thead>
        <tr>
          <th>Order</th>
          <th>Tag</th>
          <th>Intervals</th>
          <th class="text-right">Weight</th>
          <th class="text-right">Read back</th>
          <th class="text-right">Days recorded</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in relatedRows" :key="r.o.order">
          <td>
            {{ r.o.order }}
            <div v-if="r.rel !== 'same species'" class="planner-hint"><em>{{ r.o.species }}</em></div>
          </td>
          <td class="text-no-wrap">{{ r.o.type }} {{ r.o.hw }}</td>
          <td class="planner-small">
            <span
              v-for="key in TAG_TYPES[r.o.type].sensors.filter((k) => r.o[k] > 0)"
              :key="key"
              class="planner-interval-chip"
              :title="SENSOR_BY_KEY[key].label"
            >
              {{ SHORT_LABEL[key] }} {{ formatInterval(r.o[key]) }}
            </span>
          </td>
          <td class="text-right text-no-wrap">{{ r.s.weight.n ? `${fmt(r.s.weight.median, 2)} g` : "–" }}</td>
          <td class="text-right">{{ r.o.n_data }}/{{ r.o.n_tags }}</td>
          <td class="text-right text-no-wrap">{{ r.s.days.n ? formatDays(r.s.days.median) : "–" }}</td>
          <td><v-btn size="x-small" variant="text" color="primary" title="Use these settings" icon="mdi-arrow-up" @click="applyOrder(r.o)" /></td>
        </tr>
      </tbody>
    </v-table>
  </v-sheet>

  <v-sheet border rounded="lg" class="pa-3 mt-3 planner-agreement-box">
    <div class="planner-agreement-text">
      <span class="planner-agreement-label">For the agreement</span>
      {{ agreement || "Switch on at least one sensor." }}
    </div>
    <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-content-copy" :disabled="!agreement" @click="copyAgreement">
      {{ copied ? "Copied" : "Copy" }}
    </v-btn>
  </v-sheet>
</template>

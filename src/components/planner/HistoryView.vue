<script setup>
import { computed, ref } from "vue";
import { BATTERIES, SENSOR_BY_KEY, TAG_TYPES, formatDayRange, formatDays, formatInterval } from "../../lib/loggerModel";
import InfoNote from "./InfoNote.vue";
import { END_TYPES, orderSummary, orders, summarise } from "../../lib/plannerHistory";

const emit = defineEmits(["use"]);

const search = ref("");
const typeFilter = ref(null);
const batteryFilter = ref(null);
const onlyWithData = ref(true);
const expanded = ref([]);

const rows = computed(() =>
  orders.map((o) => {
    const s = orderSummary(o);
    const mainBattery = Object.entries(s.batteries).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { ...o, _o: o, s, mainBattery, weightMedian: s.weight.median ?? null, daysMedian: s.days.median ?? null };
  })
);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter(
    (r) =>
      (!q || r.order.toLowerCase().includes(q) || (r.species || "").toLowerCase().includes(q) || (r.country || "").toLowerCase() === q) &&
      (!typeFilter.value || r.type === typeFilter.value) &&
      (!batteryFilter.value || r.s.batteries[batteryFilter.value] > 0) &&
      (!onlyWithData.value || r.n_data > 0)
  );
});

const totals = computed(() => ({
  orders: filtered.value.length,
  tags: filtered.value.reduce((a, r) => a + r.n_tags, 0),
  data: filtered.value.reduce((a, r) => a + r.n_data, 0),
  species: new Set(filtered.value.map((r) => r.species).filter(Boolean)).size,
}));

const headers = [
  { title: "Order", key: "order" },
  { title: "Species", key: "species" },
  { title: "Year", key: "year" },
  { title: "Tag", key: "type" },
  { title: "Battery", key: "mainBattery" },
  { title: "Weight", key: "weightMedian", align: "end" },
  { title: "Read back", key: "n_data", align: "end" },
  { title: "Days recorded", key: "daysMedian", align: "end" },
  { title: "", key: "data-table-expand" },
];

function sensorRows(o) {
  const by = new Map();
  for (const d of o.downloads) {
    for (const s of d.sensors) {
      const k = `${s.sensor}|${s.interval}`;
      if (!by.has(k)) by.set(k, { sensor: s.sensor, interval: s.interval, recs: [] });
      by.get(k).recs.push(s);
    }
  }
  return [...by.values()].map((r) => ({
    ...r,
    days: summarise(r.recs.map((s) => s.days)),
    early: r.recs.filter((s) => s.early).length,
    model: summarise(r.recs.map((s) => s.predMemDays)).median,
  }));
}

const fmt = (v, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits) : "–");
</script>

<template>
  <v-sheet border rounded="lg" class="pa-4">
    <div class="history-filters">
      <v-text-field v-model="search" label="Search order, species or country code" prepend-inner-icon="mdi-magnify" density="compact" hide-details clearable />
      <v-select
        v-model="typeFilter"
        :items="[{ title: 'All tags', value: null }, ...Object.values(TAG_TYPES).map((t) => ({ title: t.key, value: t.key }))]"
        label="Tag"
        density="compact"
        hide-details
      />
      <v-select
        v-model="batteryFilter"
        :items="[{ title: 'All batteries', value: null }, ...Object.values(BATTERIES).map((b) => ({ title: b.label, value: b.key }))]"
        label="Battery"
        density="compact"
        hide-details
      />
      <v-switch v-model="onlyWithData" label="Read back only" color="primary" density="compact" hide-details />
    </div>
    <div class="planner-hint mt-3">
      {{ totals.orders }} orders · {{ totals.species }} species · {{ totals.tags }} tags produced · {{ totals.data }} read back
    </div>
    <InfoNote label="About this list" class="mb-2">
      Test orders are left out. The battery class comes from the cell named in the order remarks, or else is inferred from the order weight; "–" means it could not be inferred.
    </InfoNote>

    <v-data-table
      v-model:expanded="expanded"
      :headers="headers"
      :items="filtered"
      item-value="order"
      density="compact"
      :items-per-page="25"
      show-expand
      :sort-by="[{ key: 'year', order: 'desc' }]"
    >
      <template #item.species="{ value }"><em>{{ value || "–" }}</em></template>
      <template #item.type="{ item }">{{ item.type }} {{ item.hw }}</template>
      <template #item.mainBattery="{ value }">{{ value ? BATTERIES[value].label : "–" }}</template>
      <template #item.weightMedian="{ value }">{{ value !== null ? `${fmt(value, 2)} g` : "–" }}</template>
      <template #item.n_data="{ item }">{{ item.n_data }}/{{ item.n_tags }}</template>
      <template #item.daysMedian="{ value }">{{ value !== null ? formatDays(value) : "–" }}</template>

      <template #expanded-row="{ columns, item }">
        <tr>
          <td :colspan="columns.length" class="history-detail">
            <div class="history-detail-grid">
              <div>
                <div class="species-check-label">Settings</div>
                <div class="planner-small">
                  <span v-for="key in TAG_TYPES[item.type].sensors.filter((k) => item[k] > 0)" :key="key" class="mr-3">
                    {{ SENSOR_BY_KEY[key].label }} {{ formatInterval(item[key]) }}
                  </span>
                  <span class="planner-hint">(from {{ item.settings_source === "files" ? "logger files" : "production database" }})</span>
                </div>
                <div class="species-check-label mt-3">Tags</div>
                <div class="planner-small">
                  <span v-for="(n, b) in item.s.batteries" :key="b" class="mr-3">{{ BATTERIES[b].label }}: {{ n }}</span>
                  · weight {{ fmt(item.s.weight.min, 2) }}–{{ fmt(item.s.weight.max, 2) }} g · harness {{ item.harness || "–" }}
                </div>
                <div class="species-check-label mt-3">How recordings ended</div>
                <div class="planner-small">
                  <div v-for="(n, e) in item.s.ends" :key="e">{{ END_TYPES[e] }}: {{ n }}</div>
                  <div v-if="!Object.keys(item.s.ends).length" class="planner-hint">No logger files read yet.</div>
                </div>
              </div>
              <div>
                <v-table v-if="item.downloads.length" density="compact">
                  <thead>
                    <tr>
                      <th>Sensor</th>
                      <th>Every</th>
                      <th class="text-right">Days recorded</th>
                      <th class="text-right">Stopped early</th>
                      <th class="text-right">Memory full (model)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in sensorRows(item._o)" :key="`${r.sensor}${r.interval}`">
                      <td>{{ SENSOR_BY_KEY[r.sensor].label }}</td>
                      <td>{{ formatInterval(r.interval) }}</td>
                      <td class="text-right">{{ formatDays(r.days.median) }} <span class="planner-hint">({{ formatDayRange(r.days.min, r.days.max) }})</span></td>
                      <td class="text-right">{{ r.early }}/{{ r.recs.length }}</td>
                      <td class="text-right">{{ item.type === "GDL3pam" ? formatDays(r.model) : "–" }}</td>
                    </tr>
                  </tbody>
                </v-table>
              </div>
            </div>
            <v-btn size="small" color="primary" variant="tonal" class="mt-3" prepend-icon="mdi-arrow-right" @click="emit('use', item._o)">
              Use as starting point
            </v-btn>
          </td>
        </tr>
      </template>
    </v-data-table>
  </v-sheet>
</template>

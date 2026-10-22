<script setup>
import { onMounted, ref } from "vue";
import packageJson from "../../../package.json";
import { historyInfo } from "../../lib/plannerHistory";
import PlanView from "./PlanView.vue";
import HistoryView from "./HistoryView.vue";

// A plan opened from the list of past deployments ("use as starting point")
const startingPoint = ref(null);

function openInPlan(order) {
  startingPoint.value = { ...order, _at: Date.now() };
}

// #/history links open the planner at the list of past deployments
const historySection = ref(null);
onMounted(() => {
  if (window.location.hash.startsWith("#/history")) historySection.value?.scrollIntoView();
});
</script>

<template>
  <v-container class="planner-container py-6">
    <header class="planner-header">
      <div>
        <h1 class="planner-title">
          Logger planner <v-chip size="small" color="warning" variant="tonal" class="ml-1">beta</v-chip>
        </h1>
      </div>
    </header>

    <PlanView :starting-point="startingPoint" />

    <section ref="historySection" class="mt-6" aria-labelledby="planner-history-title">
      <h2 id="planner-history-title" class="planner-section-title">All past SOI deployments</h2>
      <HistoryView @use="openInPlan" />
    </section>

    <footer class="planner-footer">
      History from {{ historyInfo.source }} (built {{ historyInfo.generated }}). Battery and memory figures are
      estimates. GeoCollab form v{{ packageJson.version }}.
    </footer>
  </v-container>
</template>

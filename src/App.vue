<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import GeoCollabWizard from './components/GeoCollabWizard.vue'

// Loaded on demand so the intake form doesn't download the deployment history
const LoggerPlanner = defineAsyncComponent(() => import('./components/planner/LoggerPlanner.vue'))

const hash = ref(window.location.hash)
const onHashChange = () => {
  hash.value = window.location.hash
}
onMounted(() => window.addEventListener('hashchange', onHashChange))
onBeforeUnmount(() => window.removeEventListener('hashchange', onHashChange))

// #/planner and #/history open the logger planner; anything else is the intake form
const plannerView = computed(() => hash.value.startsWith('#/planner') || hash.value.startsWith('#/history'))
</script>

<template>
  <v-app>
    <v-main>
      <LoggerPlanner v-if="plannerView" />
      <GeoCollabWizard v-else />
    </v-main>
  </v-app>
</template>

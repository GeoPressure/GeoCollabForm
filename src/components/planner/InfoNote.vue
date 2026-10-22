<script setup>
// A discreet "ⓘ" link that opens an explanation below it
import { ref } from "vue";

defineProps({ label: { type: String, default: "How this is computed" } });

const open = ref(false);
</script>

<template>
  <div class="info-note">
    <button type="button" class="info-note-toggle" :aria-expanded="open" @click="open = !open">
      <v-icon icon="mdi-information-outline" size="16" />
      <span>{{ label }}</span>
      <v-icon :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
    </button>
    <v-expand-transition>
      <div v-show="open" class="info-note-body">
        <slot />
      </div>
    </v-expand-transition>
  </div>
</template>

<style scoped>
.info-note {
  margin-top: 6px;
}
.info-note-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.8rem;
  color: var(--gc-color-muted, #60716d);
  cursor: pointer;
}
.info-note-toggle:hover {
  color: var(--gc-color-text, #1f2a28);
}
.info-note-body {
  padding: 4px 0 0 20px;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--gc-color-muted, #60716d);
}
</style>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import joinedSpeciesCsv from "../data/avilist_soi_avonet_joined.csv?raw";
import { buildSpeciesFeedback } from "../lib/species";
import { parseSpeciesRecordsFromJoinedCsv } from "../lib/speciesCatalog";
import { createDefaultFormDraft } from "../types";
import MapboxLocationPicker from "./MapboxLocationPicker.vue";

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const GOOGLE_SHEETS_WEBHOOK_URL = (import.meta.env.VITE_GOOGLE_SHEETS_WEBHOOK_URL || "").trim();

const STEPS = [
  { key: "context", title: "Context" },
  { key: "species", title: "Species" },
  { key: "location", title: "Location" },
  { key: "project", title: "Project" },
  { key: "contact", title: "Contact" },
];
const WIZARD_STORAGE_KEY = "geocollab:wizard:v1";
const STORAGE_SAVE_DEBOUNCE_MS = 300;
const SUBMISSION_FOREGROUND_WAIT_MS = 1800;

const speciesRecords = parseSpeciesRecordsFromJoinedCsv(joinedSpeciesCsv);
const speciesById = new Map(speciesRecords.map((item) => [item.avibase_id, item]));

const step = ref(1);
const draft = reactive(createDefaultFormDraft());
const speciesSearch = ref("");
const submissionError = ref("");
const submissionState = ref("idle");
const lastSubmissionPayload = ref(null);
const contextReadConfirmed = ref(false);
const contextAlignConfirmed = ref(false);
let saveTimerId = null;

const selectedSpecies = computed(() => speciesById.get(draft.species.avibase_id));
const speciesFeedback = computed(() => buildSpeciesFeedback(selectedSpecies.value));
const speciesBirdsOfWorldUrl = computed(() => {
  if (!selectedSpecies.value) return "";
  return selectedSpecies.value.birds_of_the_world_url;
});
const hasGoogleSheetsWebhook = computed(() => GOOGLE_SHEETS_WEBHOOK_URL.length > 0);
const isSubmitting = computed(() => submissionState.value === "submitting");
const isSubmissionPending = computed(() => submissionState.value === "pending");
const isSubmissionLocked = computed(() => submissionState.value === "success");
const progressValue = computed(() => (step.value / STEPS.length) * 100);
const hasSelectedLocation = computed(
  () => draft.location.latitude !== null && draft.location.longitude !== null,
);
const speciesOptions = computed(() => {
  if (speciesSearch.value.trim().length >= 1) {
    return speciesRecords;
  }

  return selectedSpecies.value ? [selectedSpecies.value] : [];
});

function speciesItemTitle(item) {
  return item?.common_name || "";
}

function speciesFilter(_value, query, item) {
  const q = query.toLowerCase().trim();
  if (q.length < 1) return false;
  if (!item) return false;

  return (
    item.raw.common_name.toLowerCase().includes(q) ||
    item.raw.scientific_name.toLowerCase().includes(q) ||
    item.raw.avibase_id.toLowerCase().includes(q)
  );
}

function isBlank(value) {
  return value.trim().length === 0;
}

function hasPositiveNumber(value) {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function stepOneValid() {
  return contextReadConfirmed.value && contextAlignConfirmed.value;
}

function stepTwoValid() {
  return Boolean(selectedSpecies.value && speciesFeedback.value?.canContinue);
}

function stepThreeValid() {
  return (
    !isBlank(draft.location.country) &&
    !isBlank(draft.location.site_name) &&
    draft.location.latitude !== null &&
    draft.location.longitude !== null &&
    hasPositiveNumber(draft.location.radius_km)
  );
}

function stepFourValid() {
  const project = draft.project;
  return (
    !isBlank(project.project_description) &&
    hasPositiveNumber(project.expected_number_equipped) &&
    !isBlank(project.recapture_rationale) &&
    !isBlank(project.permits_status_text)
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function stepFiveValid() {
  return (
    !isBlank(draft.contact.full_name) &&
    !isBlank(draft.contact.address) &&
    isValidEmail(draft.contact.email)
  );
}

function isStepValid(stepIndex) {
  if (stepIndex === 1) return stepOneValid();
  if (stepIndex === 2) return stepTwoValid();
  if (stepIndex === 3) return stepThreeValid();
  if (stepIndex === 4) return stepFourValid();
  if (stepIndex === 5) return stepFiveValid();
  return true;
}

const canContinueCurrentStep = computed(() => isStepValid(step.value));

function goBack() {
  if (step.value > 1) {
    step.value -= 1;
  }
}

function goNext() {
  if (step.value < STEPS.length && canContinueCurrentStep.value) {
    step.value += 1;
  }
}

function feedbackToneIcon(tone) {
  if (tone === "success") return "mdi-check-circle";
  if (tone === "warning") return "mdi-alert-circle";
  if (tone === "error") return "mdi-close-circle";
  return "mdi-information";
}

function feedbackToneColor(tone) {
  return tone === "info" ? "primary" : tone;
}

function isFiniteNumberOrNull(value) {
  return value === null || Number.isFinite(value);
}

function clampStep(value) {
  if (!Number.isInteger(value)) return 1;
  if (value < 1) return 1;
  if (value > STEPS.length) return STEPS.length;
  return value;
}

function assignPersistedDraft(nextDraft) {
  if (!nextDraft || typeof nextDraft !== "object") return;

  if (nextDraft.species && typeof nextDraft.species === "object") {
    if (typeof nextDraft.species.avibase_id === "string") {
      draft.species.avibase_id = nextDraft.species.avibase_id;
    }
  }

  if (nextDraft.location && typeof nextDraft.location === "object") {
    const location = nextDraft.location;
    if (typeof location.country === "string") draft.location.country = location.country;
    if (typeof location.site_name === "string") draft.location.site_name = location.site_name;
    if (isFiniteNumberOrNull(location.latitude)) draft.location.latitude = location.latitude;
    if (isFiniteNumberOrNull(location.longitude)) draft.location.longitude = location.longitude;
    if (isFiniteNumberOrNull(location.radius_km)) draft.location.radius_km = location.radius_km;
  }

  if (nextDraft.project && typeof nextDraft.project === "object") {
    const project = nextDraft.project;
    if (typeof project.project_description === "string") {
      draft.project.project_description = project.project_description;
    }
    if (isFiniteNumberOrNull(project.expected_number_equipped)) {
      draft.project.expected_number_equipped = project.expected_number_equipped;
    }
    if (typeof project.recapture_rationale === "string") {
      draft.project.recapture_rationale = project.recapture_rationale;
    }
    if (typeof project.permits_status_text === "string") {
      draft.project.permits_status_text = project.permits_status_text;
    }
  }

  if (nextDraft.contact && typeof nextDraft.contact === "object") {
    const contact = nextDraft.contact;
    if (typeof contact.full_name === "string") draft.contact.full_name = contact.full_name;
    if (typeof contact.email === "string") draft.contact.email = contact.email;
    if (typeof contact.affiliation === "string") draft.contact.affiliation = contact.affiliation;
    if (typeof contact.address === "string") draft.contact.address = contact.address;
    if (typeof contact.comments === "string") draft.contact.comments = contact.comments;
  }
}

function getPersistedWizardState() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(WIZARD_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function restorePersistedWizardState() {
  const persisted = getPersistedWizardState();
  if (!persisted || typeof persisted !== "object") return;

  step.value = clampStep(persisted.step);
  contextReadConfirmed.value = Boolean(persisted.contextReadConfirmed);
  contextAlignConfirmed.value = Boolean(persisted.contextAlignConfirmed);
  assignPersistedDraft(persisted.draft);

  if (!speciesById.has(draft.species.avibase_id)) {
    draft.species.avibase_id = "";
  }
}

function buildPersistedWizardState() {
  return {
    version: 1,
    saved_at_iso: new Date().toISOString(),
    step: step.value,
    contextReadConfirmed: contextReadConfirmed.value,
    contextAlignConfirmed: contextAlignConfirmed.value,
    draft,
  };
}

function persistWizardStateNow() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(buildPersistedWizardState()));
}

function schedulePersistWizardState() {
  if (typeof window === "undefined") return;

  if (saveTimerId !== null) {
    clearTimeout(saveTimerId);
  }

  saveTimerId = window.setTimeout(() => {
    saveTimerId = null;
    persistWizardStateNow();
  }, STORAGE_SAVE_DEBOUNCE_MS);
}

function clearPersistedWizardState() {
  if (typeof window === "undefined") return;

  if (saveTimerId !== null) {
    clearTimeout(saveTimerId);
    saveTimerId = null;
  }

  window.localStorage.removeItem(WIZARD_STORAGE_KEY);
}

onMounted(() => {
  restorePersistedWizardState();
});

onBeforeUnmount(() => {
  if (saveTimerId !== null) {
    clearTimeout(saveTimerId);
  }
});

watch(
  [step, draft, contextReadConfirmed, contextAlignConfirmed],
  () => {
    if (submissionState.value === "success") return;
    schedulePersistWizardState();
  },
  {
    deep: true,
  },
);

function buildSubmissionPayload() {
  const species = selectedSpecies.value;

  return {
    submitted_at_iso: new Date().toISOString(),
    species_common_name: species?.common_name || "",
    species_body_mass_g: Number.isFinite(species?.body_mass_g) ? species.body_mass_g : null,
    species_birds_of_the_world_url: species?.birds_of_the_world_url || "",
    location_site_name: draft.location.site_name,
    location_country: draft.location.country,
    location_latitude: draft.location.latitude,
    location_longitude: draft.location.longitude,
    location_radius_km: draft.location.radius_km,
    project_description: draft.project.project_description,
    project_expected_number_equipped: draft.project.expected_number_equipped,
    project_recapture_rationale: draft.project.recapture_rationale,
    project_permits_status: draft.project.permits_status_text,
    contact_full_name: draft.contact.full_name,
    contact_email: draft.contact.email,
    contact_affiliation: draft.contact.affiliation,
    contact_address: draft.contact.address,
    contact_comments: draft.contact.comments,
  };
}

async function saveSubmissionToGoogleSheets(payload) {
  if (!hasGoogleSheetsWebhook.value) {
    throw new Error("Google Sheets webhook is not configured. Set VITE_GOOGLE_SHEETS_WEBHOOK_URL.");
  }

  const body = JSON.stringify(payload);

  // Apps Script web apps on script.google.com often fail CORS preflight from local/dev origins.
  // Use a simple no-cors request to send the payload without preflight.
  const sendPromise = fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body,
    keepalive: true,
  });

  // no-cors responses are opaque. We cap UI wait time to avoid a long spinner
  // while still letting the request continue in the background.
  const maxWaitMs = SUBMISSION_FOREGROUND_WAIT_MS;
  const winner = await Promise.race([
    sendPromise.then(() => "sent"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), maxWaitMs)),
  ]);

  if (winner === "sent") return { status: "sent" };
  return { status: "pending", settle: sendPromise };
}

async function submitForm() {
  if (isSubmitting.value || isSubmissionLocked.value || isSubmissionPending.value) return;

  submissionState.value = "submitting";
  submissionError.value = "";
  let payload = null;

  try {
    payload = buildSubmissionPayload();
    lastSubmissionPayload.value = payload;
    const submissionResult = await saveSubmissionToGoogleSheets(payload);

    if (submissionResult.status === "sent") {
      submissionState.value = "success";
      clearPersistedWizardState();
      return;
    }

    submissionState.value = "pending";
    submissionResult.settle
      .then(() => {
        if (submissionState.value !== "pending") return;
        submissionState.value = "success";
        clearPersistedWizardState();
      })
      .catch((err) => {
        if (submissionState.value !== "pending") return;
        submissionState.value = "error";
        submissionError.value =
          err instanceof Error
            ? err.message
            : "Submission failed after background retry. Please try again.";
      });
  } catch (error) {
    submissionState.value = "error";
    lastSubmissionPayload.value = payload ?? buildSubmissionPayload();
    submissionError.value =
      error instanceof Error ? error.message : "Submission failed. Please try again.";
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsvContent(payload) {
  const headers = Object.keys(payload);
  const row = headers.map((key) => csvEscape(payload[key]));
  return `${headers.join(",")}\n${row.join(",")}\n`;
}

function toDownloadStamp(date) {
  const YYYY = String(date.getFullYear());
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const DD = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${YYYY}${MM}${DD}-${hh}${mm}${ss}`;
}

function downloadSubmissionCsv() {
  const payload = lastSubmissionPayload.value ?? buildSubmissionPayload();
  const csv = buildCsvContent(payload);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const filename = `geocollab-submission-${toDownloadStamp(now)}.csv`;
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

defineExpose({
  step,
  draft,
  speciesRecords,
  selectedSpecies,
  canContinueCurrentStep,
  goNext,
  goBack,
  submitForm,
  downloadSubmissionCsv,
});

if (typeof window !== "undefined" && import.meta.env.DEV) {
  window.__geoWizard = {
    step,
    draft,
    speciesRecords,
    goNext,
    goBack,
    submitForm,
    downloadSubmissionCsv,
  };
}
</script>

<template>
  <v-container class="wizard-container py-8">
    <v-sheet class="wizard-shell" border rounded="lg" elevation="1">
      <header class="wizard-header">
        <div class="wizard-hero">
          <div class="wizard-hero__backdrop" aria-hidden="true" />
          <a
            class="wizard-brand wizard-brand--top"
            href="https://www.vogelwarte.ch/en/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div class="wizard-brand__mark">
              <img
                src="/SchweizerischeVogelwarteSmall.svg"
                alt="Swiss Ornithological Institute logo"
                class="wizard-brand__logo"
              />
            </div>
            <div class="wizard-brand__text">Swiss Ornithological Institute</div>
          </a>
          <div class="wizard-hero__content pa-4 pa-md-6">
            <h1 class="page-title">GeoCollab Collaboration Intake</h1>
            <p class="wizard-step-meta">
              Step {{ step }} of {{ STEPS.length }} · {{ STEPS[step - 1]?.title }}
            </p>

            <v-progress-linear
              color="primary"
              bg-color="white"
              :bg-opacity="0.28"
              :model-value="progressValue"
              height="7"
              rounded
              class="wizard-progress"
            />
          </div>
        </div>
      </header>

      <div class="wizard-step-panel">
        <section v-show="step === 1" data-testid="step-1">
          <h2 class="step-title">1. GeoCollab Project Context</h2>
          <p class="step-description">Review the key GeoCollab criteria below before continuing.</p>

          <div class="collab-intro-content">
            <p>
              This intake helps determine whether your project is a strong fit for collaboration
              within the GeoCollab program. Submission does not guarantee support: not all projects
              can be accommodated, and selection also depends on the number of applications received
              and our internal capacity.
            </p>

            <section class="collab-section">
              <div class="collab-section-title">
                <v-icon icon="mdi-earth" size="18" color="primary" />
                <h3>What is GeoCollab?</h3>
              </div>
              <ul class="collab-list">
                <li>
                  GeoCollab is
                  <a
                    href="https://www.vogelwarte.ch/en/projects/tracking-least-known-species/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    a project of the Swiss Ornithological Institute (SOI)
                  </a>
                  for collaborative multi-sensor geolocator research.
                </li>
                <li>
                  Its main goal is to expand knowledge of bird migration in data-poor species and
                  regions.
                </li>
                <li>This is done by building standardized, reproducible, and reusable datasets.</li>
                <li>It supports both species-specific studies and large-scale comparative analyses.</li>
              </ul>
            </section>

            <section class="collab-section">
              <div class="collab-section-title">
                <v-icon icon="mdi-account-group-outline" size="18" color="primary" />
                <h3>How does the collaboration work?</h3>
              </div>
              <ul class="collab-list">
                <li>The Swiss Ornithological Institute provides geolocators free of charge.</li>
                <li>
                  The collaborator conducts fieldwork: deployment, recapture, and metadata
                  collection.
                </li>
                <li>Devices are returned to SOI for data extraction.</li>
                <li>
                  Standardized trajectory analysis using
                  <a
                    href="https://geopressure.org/GeoPressureManual/"
                    target="_blank"
                    rel="noopener noreferrer"
                    >GeoPressureR</a
                  >
                  is typically performed by SOI, but collaborators are welcome to participate.
                </li>
                <li>
                  Data are published as
                  <a
                    href="https://geopressure.org/GeoLocator-DP/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GeoLocator Data Package
                  </a>
                  records on
                  <a
                    href="https://zenodo.org/communities/geolocator-dp/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Zenodo (GeoLocator-DP community) </a
                  >, typically with an embargo until first publications.
                </li>
                <li>Collaborators are welcome to lead species-level publications.</li>
                <li>
                  At the same time, data is available for broad multi-species analyses for
                  researchers at SOI.
                </li>
              </ul>
            </section>

            <section class="collab-section">
              <div class="collab-section-title">
                <v-icon icon="mdi-package-variant-closed-check" size="18" color="primary" />
                <h3>What is expected from collaborators</h3>
              </div>
              <ul class="collab-list">
                <li>Conduct reliable fieldwork (capture, tagging, recapture).</li>
                <li>Ensure permits and ethical compliance.</li>
                <li>Provide complete and consistent metadata.</li>
                <li>Commit to a multi-year project (2 to 4 years).</li>
                <li>Maintain communication and follow agreed timelines.</li>
              </ul>
            </section>

            <section class="collab-section">
              <div class="collab-section-title">
                <v-icon icon="mdi-target" size="18" color="primary" />
                <h3>What we are looking for</h3>
              </div>
              <ul class="collab-list">
                <li>Target poorly known species or regions, as detailed on the next pages.</li>
                <li>Have high recapture feasibility.</li>
                <li>Fill key gaps in migration knowledge.</li>
              </ul>
            </section>

            <section class="collab-section">
              <div class="collab-section-title">
                <v-icon icon="mdi-check-decagram-outline" size="18" color="primary" />
                <h3>Confirmation</h3>
              </div>
              <v-checkbox
                v-model="contextReadConfirmed"
                density="compact"
                hide-details
                class="collab-confirm"
                label="I have read and understood the collaboration framework."
              />
              <v-checkbox
                v-model="contextAlignConfirmed"
                density="compact"
                hide-details
                class="collab-confirm"
                label="I confirm that my project aligns with these expectations."
              />
            </section>
          </div>
        </section>

        <section v-show="step === 2" data-testid="step-2">
          <h2 class="step-title">2. Species</h2>
          <p class="step-description">Select your focal species to assess feasibility.</p>
          <p class="step-description species-scope-note">
            <v-icon icon="mdi-information-outline" size="14" class="species-scope-note-icon" />
            Included species are limited to the following orders: Passeriformes, Apodiformes,
            Caprimulgiformes, Coraciiformes, Piciformes, Strigiformes, and Bucerotiformes.
          </p>

          <v-autocomplete
            v-model="draft.species.avibase_id"
            v-model:search="speciesSearch"
            label="Focal species"
            :items="speciesOptions"
            :item-title="speciesItemTitle"
            item-value="avibase_id"
            :custom-filter="speciesFilter"
            :hide-no-data="speciesSearch.trim().length < 1"
            :no-data-text="
              speciesSearch.trim().length < 1
                ? 'Type at least 1 letter to search'
                : 'No species found'
            "
            clearable
            density="comfortable"
            data-testid="species-select"
          />

          <v-sheet
            v-if="selectedSpecies && speciesFeedback"
            class="species-profile-panel mt-4 pa-4"
            border
            rounded="lg"
            data-testid="species-feedback"
          >
            <div class="species-profile-header">
              <h3 class="species-profile-title mb-0">
                <span class="species-profile-name">{{ selectedSpecies.common_name }}</span>
                <span class="species-profile-latin">
                  (<em>{{ selectedSpecies.scientific_name }}</em
                  >)
                </span>
              </h3>
              <a
                class="species-profile-link"
                :href="speciesBirdsOfWorldUrl"
                target="_blank"
                rel="noopener noreferrer"
              >
                <v-icon icon="mdi-open-in-new" size="16" />
                <span>BOW species page</span>
              </a>
            </div>

            <div class="font-weight-medium species-feedback-title mt-4">
              {{ speciesFeedback.title }}
            </div>
            <div class="species-checks-grid mt-3">
              <div
                v-for="item in speciesFeedback.items"
                :key="item.label"
                :class="`species-check-tile species-check-tile--${item.tone}`"
              >
                <div class="species-check-head">
                  <v-icon
                    :icon="feedbackToneIcon(item.tone)"
                    :color="feedbackToneColor(item.tone)"
                    size="18"
                    class="species-feedback-icon"
                  />
                  <span class="species-check-label">{{ item.label }}</span>
                </div>
                <div
                  v-if="item.label === 'Body mass' && item.emphasis"
                  class="species-check-metrics"
                >
                  <div class="species-check-metric-main">{{ item.emphasis.weight }}</div>
                  <div class="species-check-metric-side">
                    <div class="species-check-metric-pct">{{ item.emphasis.loggerPct }}</div>
                    <div class="species-check-metric-caption">{{ item.emphasis.caption }}</div>
                  </div>
                </div>
                <p class="species-check-text mb-0">{{ item.text }}</p>
              </div>
            </div>

            <div
              :class="`species-final-assessment mt-4 species-final-assessment--${speciesFeedback.finalTone}`"
            >
              <v-icon
                :icon="feedbackToneIcon(speciesFeedback.finalTone)"
                :color="feedbackToneColor(speciesFeedback.finalTone)"
                size="20"
              />
              <div>
                <div class="species-final-assessment-label">Final species assessment</div>
                <p class="species-final-assessment-text mb-0">{{ speciesFeedback.finalText }}</p>
              </div>
            </div>
          </v-sheet>
        </section>

        <section v-show="step === 3" data-testid="step-3">
          <h2 class="step-title">3. Location</h2>
          <p class="step-description">
            Click on the map to indicate the main deployment location. Change the radius to show
            the size of the study area.
          </p>

          <MapboxLocationPicker
            v-if="step === 3"
            :token="MAPBOX_TOKEN"
            :latitude="draft.location.latitude"
            :longitude="draft.location.longitude"
            :radius-km="draft.location.radius_km ?? 20"
            @update:latitude="(v) => (draft.location.latitude = v)"
            @update:longitude="(v) => (draft.location.longitude = v)"
            @update:radius-km="(v) => (draft.location.radius_km = v)"
            @update:country="(v) => (draft.location.country = v)"
            @update:site-name="(v) => (draft.location.site_name = v)"
          />

          <v-alert v-if="!hasSelectedLocation" type="info" variant="tonal" class="mt-6">
            Select a location on the map to continue. Country and location name will be pre-filled
            from geocoding.
          </v-alert>

          <template v-if="hasSelectedLocation">
            <div class="mt-6">
              <p class="step-description mb-1">
                Review and edit the auto-filled location details so they match your actual field
                study site and the country where deployment will occur.
              </p>
              <v-row class="mt-2">
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="draft.location.site_name"
                    label="Location name"
                    placeholder="e.g., Aargau breeding site"
                    density="comfortable"
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="draft.location.country"
                    label="Country"
                    placeholder="e.g., Switzerland"
                    density="comfortable"
                  />
                </v-col>
              </v-row>
            </div>
          </template>
        </section>

        <section v-show="step === 4" data-testid="step-4">
          <h2 class="step-title">4. Project Details</h2>
          <p class="step-description">
            Provide a concise project narrative focusing on novelty and feasibility.
          </p>

          <div class="project-simple-stack">
            <div>
              <div class="project-simple-label">Project description</div>
              <p class="project-simple-subtext">
                Describe the study system, including the species and population, the study site, and
                the ringing context (including any past effort). Outline the planned fieldwork,
                including timing and number of sessions, as well as the expected project duration.
              </p>
              <v-textarea
                v-model="draft.project.project_description"
                rows="7"
                auto-grow
                density="comfortable"
                hide-details="auto"
              />
            </div>

            <div>
              <div class="project-simple-label">Number of individuals</div>
              <p class="project-simple-subtext">
                Maximum number of individuals that could be equipped with geolocators.
              </p>
              <v-text-field
                v-model.number="draft.project.expected_number_equipped"
                type="number"
                min="0"
                step="1"
                density="comfortable"
                hide-details="auto"
              />
            </div>

            <div>
              <div class="project-simple-label">Recapture feasibility</div>
              <p class="project-simple-subtext">
                Recapturing the same individuals is essential. Provide past inter-annual recapture
                rates if available, or justify expected recapture success based on site fidelity,
                trapping strategy, or previous experience.
              </p>
              <v-textarea
                v-model="draft.project.recapture_rationale"
                rows="7"
                auto-grow
                density="comfortable"
                hide-details="auto"
              />
            </div>

            <div>
              <div class="project-simple-label">Permits and approvals</div>
              <p class="project-simple-subtext">
                Summarize the status of ringing licences, required permits, and ethics approvals,
                and indicate whether these are already obtained.
              </p>
              <v-textarea
                v-model="draft.project.permits_status_text"
                rows="5"
                auto-grow
                density="comfortable"
                hide-details="auto"
              />
            </div>
          </div>
        </section>

        <section v-show="step === 5" data-testid="step-5">
          <h2 class="step-title">5. Contact Information</h2>
          <p class="step-description">Provide contact details for follow-up.</p>
          <v-alert
            v-if="!hasGoogleSheetsWebhook"
            type="warning"
            variant="tonal"
            class="mb-4"
            data-testid="google-sheets-not-configured"
          >
            Submission endpoint is not configured. Add
            <code>VITE_GOOGLE_SHEETS_WEBHOOK_URL</code> to enable submission.
          </v-alert>

          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="draft.contact.full_name"
                label="Full name"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="draft.contact.email"
                label="Email"
                type="email"
                density="comfortable"
                :error="draft.contact.email.length > 0 && !isValidEmail(draft.contact.email)"
                error-messages=""
              />
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="draft.contact.affiliation"
                label="Affiliation (optional)"
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field v-model="draft.contact.address" label="Address" density="comfortable" />
            </v-col>
          </v-row>

          <v-divider class="my-6" />
          <p class="step-description mb-3">Optional final note</p>
          <v-textarea
            v-model="draft.contact.comments"
            label="Additional comments or questions"
            rows="3"
            density="comfortable"
          />
          <v-alert
            v-if="submissionState === 'error'"
            type="error"
            variant="tonal"
            class="mt-4 submit-alert submit-alert--error"
          >
            <p class="mb-2">{{ submissionError }}</p>
            <p class="mb-3">
              If submission still fails, download the CSV backup and send it to
              <strong>raphael.nussbaumer@vogelwarte.ch</strong>.
            </p>
            <v-btn size="small" variant="outlined" color="error" @click="downloadSubmissionCsv">
              Download CSV Backup
            </v-btn>
          </v-alert>
          <v-alert
            v-if="submissionState === 'pending'"
            variant="flat"
            class="mt-4 submit-alert submit-alert--pending"
          >
            <div class="submit-alert-pending-content">
              <v-progress-circular
                indeterminate
                :size="20"
                :width="2.5"
                color="white"
                aria-label="Submission in progress"
              />
              <span
                >Submission is still in progress. Keep this tab open until confirmation
                appears.</span
              >
            </div>
          </v-alert>
          <v-alert
            v-if="submissionState === 'success'"
            type="success"
            variant="tonal"
            class="mt-4 submit-alert submit-alert--success"
            data-testid="export-success"
          >
            Submission successful.
          </v-alert>
        </section>
      </div>

      <v-divider />
      <footer class="wizard-nav">
        <v-btn variant="text" :disabled="step === 1" data-testid="back-btn" @click="goBack">
          Back
        </v-btn>
        <v-spacer />

        <v-btn
          v-if="step < STEPS.length"
          color="primary"
          :disabled="!canContinueCurrentStep"
          data-testid="continue-btn"
          @click="goNext"
        >
          Continue
        </v-btn>

        <v-btn
          v-else
          color="primary"
          :disabled="
            !canContinueCurrentStep || isSubmitting || isSubmissionLocked || isSubmissionPending
          "
          :loading="isSubmitting"
          data-testid="submit-btn"
          @click="submitForm"
        >
          {{ isSubmissionLocked ? "Submitted" : "Submit" }}
        </v-btn>
      </footer>
    </v-sheet>
  </v-container>
</template>

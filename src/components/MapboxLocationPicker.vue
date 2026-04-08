<script setup>
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import mapboxgl from "mapbox-gl";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { themeTokens } from "../plugins/vuetify";

const props = defineProps({
  token: {
    type: String,
    required: true,
  },
  latitude: {
    type: Number,
    default: null,
  },
  longitude: {
    type: Number,
    default: null,
  },
  radiusKm: {
    type: Number,
    required: true,
  },
});

const emit = defineEmits([
  "update:latitude",
  "update:longitude",
  "update:radiusKm",
  "update:country",
  "update:siteName",
]);

const mapContainer = ref(null);
const mapError = ref("");

let map = null;
let marker = null;
let radiusHandles = [];
let geocoder = null;
let resizeObserver = null;

const STUDY_AREA_SOURCE_ID = "study-area-source";
const STUDY_AREA_FILL_ID = "study-area-fill";
const STUDY_AREA_LINE_ID = "study-area-line";
const RADIUS_HANDLE_BEARINGS = [0, 90, 180, 270];
const MIN_RADIUS_KM = 0.1;
const MARKER_TIP_OFFSET_Y = 6;
const SITE_NAME_TYPES_PRIORITY = [
  "address",
  "neighborhood",
  "locality",
  "place",
  "district",
  "region",
];
const EMPTY_GEOJSON = {
  type: "FeatureCollection",
  features: [],
};

function roundCoord(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function makeCirclePolygon(longitude, latitude, radiusKm) {
  const safeRadius = Math.max(radiusKm, MIN_RADIUS_KM);
  const points = 96;
  const coords = [];

  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * (2 * Math.PI);
    const dx = safeRadius * Math.cos(angle);
    const dy = safeRadius * Math.sin(angle);

    const lng = longitude + dx / (111.32 * Math.cos((latitude * Math.PI) / 180));
    const lat = latitude + dy / 110.574;
    coords.push([lng, lat]);
  }

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [coords],
    },
  };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceKm(fromLng, fromLat, toLng, toLat) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointAtRadius(centerLongitude, centerLatitude, radiusKm, bearingDeg) {
  const safeRadius = Math.max(radiusKm, MIN_RADIUS_KM);
  const angle = (bearingDeg * Math.PI) / 180;
  const dx = safeRadius * Math.sin(angle);
  const dy = safeRadius * Math.cos(angle);

  const longitude = centerLongitude + dx / (111.32 * Math.cos((centerLatitude * Math.PI) / 180));
  const latitude = centerLatitude + dy / 110.574;
  return [longitude, latitude];
}

function createRadiusHandleElement() {
  const el = document.createElement("div");
  el.className = "gc-radius-handle";
  return el;
}

function clearRadiusHandles() {
  for (const handle of radiusHandles) {
    handle.remove();
  }
  radiusHandles = [];
}

function syncRadiusHandlePositions(radiusOverride) {
  if (
    !map ||
    props.latitude === null ||
    props.longitude === null ||
    radiusHandles.length !== RADIUS_HANDLE_BEARINGS.length
  ) {
    clearRadiusHandles();
    return;
  }

  const radius = radiusOverride ?? props.radiusKm;
  RADIUS_HANDLE_BEARINGS.forEach((bearing, idx) => {
    const [lng, lat] = pointAtRadius(props.longitude, props.latitude, radius, bearing);
    radiusHandles[idx].setLngLat([lng, lat]);
  });
}

function applyRadiusFromHandle(handlePosition) {
  if (props.latitude === null || props.longitude === null) {
    return;
  }

  const radius = Math.max(
    MIN_RADIUS_KM,
    distanceKm(props.longitude, props.latitude, handlePosition.lng, handlePosition.lat),
  );
  const roundedRadius = Math.round(radius * 10) / 10;
  emit("update:radiusKm", roundedRadius);
  syncRadiusHandlePositions(roundedRadius);
}

function ensureRadiusHandles() {
  if (!map || props.latitude === null || props.longitude === null) {
    clearRadiusHandles();
    return;
  }

  if (radiusHandles.length === RADIUS_HANDLE_BEARINGS.length) {
    syncRadiusHandlePositions();
    return;
  }

  clearRadiusHandles();
  RADIUS_HANDLE_BEARINGS.forEach((bearing) => {
    const [lng, lat] = pointAtRadius(props.longitude, props.latitude, props.radiusKm, bearing);
    const handle = new mapboxgl.Marker({
      element: createRadiusHandleElement(),
      draggable: true,
      anchor: "center",
    })
      .setLngLat([lng, lat])
      .addTo(map);

    handle.on("drag", () => {
      applyRadiusFromHandle(handle.getLngLat());
    });

    handle.on("dragend", () => {
      applyRadiusFromHandle(handle.getLngLat());
    });

    radiusHandles.push(handle);
  });
}

function countryFromFeature(feature) {
  const contextCountry = feature?.context?.find((item) => (item.id || "").startsWith("country"));
  if (contextCountry?.text) {
    return contextCountry.text;
  }
  if (feature?.place_type?.includes("country") && feature.text) {
    return feature.text;
  }
  return "";
}

function siteNameFromFeature(feature) {
  if (feature?.text?.trim()) {
    return feature.text.trim();
  }
  if (feature?.place_name?.trim()) {
    return feature.place_name.split(",")[0].trim();
  }
  return "";
}

function bestSiteFeature(features) {
  if (!Array.isArray(features) || features.length === 0) {
    return null;
  }
  for (const targetType of SITE_NAME_TYPES_PRIORITY) {
    const match = features.find((feature) => feature?.place_type?.includes(targetType));
    if (match) {
      return match;
    }
  }
  return features[0];
}

function fallbackSiteName(longitude, latitude) {
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function applyLocationPrefill(features, longitude, latitude) {
  const country = features.find((feature) => countryFromFeature(feature));
  if (country) {
    emit("update:country", countryFromFeature(country));
  }

  const siteName = siteNameFromFeature(bestSiteFeature(features));
  emit("update:siteName", siteName || fallbackSiteName(longitude, latitude));
}

async function reverseGeocode(longitude, latitude) {
  const fetchFeatures = async (types) => {
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json`,
    );
    if (types) {
      url.searchParams.set("types", types);
    }
    // Mapbox only accepts `limit` with one reverse-geocode type.
    if (!types || !types.includes(",")) {
      url.searchParams.set("limit", "5");
    }
    url.searchParams.set("access_token", props.token);

    const response = await fetch(url.toString());
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    return Array.isArray(payload.features) ? payload.features : [];
  };

  try {
    const strictTypes = "country,region,district,place,locality,neighborhood,address";
    let features = await fetchFeatures(strictTypes);
    if (features.length === 0) {
      features = await fetchFeatures("");
    }
    applyLocationPrefill(features, longitude, latitude);
  } catch {
    emit("update:siteName", fallbackSiteName(longitude, latitude));
  }
}

function ensureMarker(longitude, latitude) {
  if (!map) {
    return;
  }

  if (!marker) {
    marker = new mapboxgl.Marker({
      color: themeTokens.primary,
      draggable: true,
      anchor: "bottom",
      // Mapbox default marker includes shadow padding below the visual tip.
      // Shift down slightly so the visible pin tip aligns with the center point.
      offset: [0, MARKER_TIP_OFFSET_Y],
    })
      .setLngLat([longitude, latitude])
      .addTo(map);

    marker.on("dragend", () => {
      if (!marker) return;
      const pos = marker.getLngLat();
      void handleLocationSelection(pos.lng, pos.lat, true);
    });

    return;
  }

  marker.setLngLat([longitude, latitude]);
}

function addCircleLayers() {
  if (!map) {
    return;
  }

  if (!map.getSource(STUDY_AREA_SOURCE_ID)) {
    map.addSource(STUDY_AREA_SOURCE_ID, {
      type: "geojson",
      data: EMPTY_GEOJSON,
    });
  }

  if (!map.getLayer(STUDY_AREA_FILL_ID)) {
    map.addLayer({
      id: STUDY_AREA_FILL_ID,
      type: "fill",
      source: STUDY_AREA_SOURCE_ID,
      paint: {
        "fill-color": themeTokens.primary,
        "fill-opacity": 0.18,
      },
    });
  }

  if (!map.getLayer(STUDY_AREA_LINE_ID)) {
    map.addLayer({
      id: STUDY_AREA_LINE_ID,
      type: "line",
      source: STUDY_AREA_SOURCE_ID,
      paint: {
        "line-color": themeTokens.primary,
        "line-width": 2.5,
        "line-opacity": 0.9,
      },
    });
  }
}

function updateCircleLayer() {
  if (!map || !map.getSource(STUDY_AREA_SOURCE_ID)) {
    return;
  }

  const source = map.getSource(STUDY_AREA_SOURCE_ID);

  if (props.latitude === null || props.longitude === null) {
    source.setData(EMPTY_GEOJSON);
    clearRadiusHandles();
    return;
  }

  source.setData(makeCirclePolygon(props.longitude, props.latitude, props.radiusKm));
  ensureRadiusHandles();
  syncRadiusHandlePositions();
}

async function handleLocationSelection(longitude, latitude, reverseLookup) {
  const roundedLongitude = roundCoord(longitude);
  const roundedLatitude = roundCoord(latitude);

  ensureMarker(roundedLongitude, roundedLatitude);
  emit("update:longitude", roundedLongitude);
  emit("update:latitude", roundedLatitude);

  if (map) {
    map.easeTo({ center: [roundedLongitude, roundedLatitude], duration: 300 });
  }

  if (reverseLookup) {
    await reverseGeocode(roundedLongitude, roundedLatitude);
  }
}

function syncMarkerFromProps() {
  if (!map) {
    return;
  }

  if (props.latitude === null || props.longitude === null) {
    if (marker) {
      marker.remove();
      marker = null;
    }
    clearRadiusHandles();
    return;
  }

  ensureMarker(props.longitude, props.latitude);
  ensureRadiusHandles();
  syncRadiusHandlePositions();
}

function initMap() {
  if (!mapContainer.value) {
    return;
  }

  try {
    mapboxgl.accessToken = props.token;

    map = new mapboxgl.Map({
      container: mapContainer.value,
      style: "mapbox://styles/mapbox/light-v11",
      center:
        props.longitude !== null && props.latitude !== null
          ? [props.longitude, props.latitude]
          : [0, 20],
      zoom: props.longitude !== null && props.latitude !== null ? 7 : 1.4,
      projection: "mercator",
    });

    map.on("load", () => {
      resizeMapToContainer();
      map?.setProjection("mercator");
      addCircleLayers();
      syncMarkerFromProps();
      updateCircleLayer();
    });

    map.on("click", (event) => {
      void handleLocationSelection(event.lngLat.lng, event.lngLat.lat, true);
    });

    geocoder = new MapboxGeocoder({
      accessToken: props.token,
      mapboxgl,
      marker: false,
      placeholder: "Search deployment location",
    });

    geocoder.on("result", (event) => {
      const center = event.result?.center;
      if (!center || center.length < 2) {
        return;
      }

      const [lng, lat] = center;
      void handleLocationSelection(lng, lat, true);
      map?.flyTo({ center: [lng, lat], zoom: 7 });
    });

    map.addControl(geocoder, "top-left");
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
  } catch (error) {
    mapError.value = error instanceof Error ? error.message : "Map could not be initialized.";
  }
}

function resizeMapToContainer() {
  if (!map || !mapContainer.value) {
    return;
  }

  if (mapContainer.value.clientWidth === 0 || mapContainer.value.clientHeight === 0) {
    return;
  }

  map.resize();
}

watch(
  () => [props.latitude, props.longitude],
  () => {
    syncMarkerFromProps();
    updateCircleLayer();
  },
);

watch(
  () => props.radiusKm,
  () => {
    updateCircleLayer();
  },
);

onMounted(() => {
  initMap();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      resizeMapToContainer();
    });

    if (mapContainer.value) {
      resizeObserver.observe(mapContainer.value);
    }
  }

  requestAnimationFrame(() => {
    resizeMapToContainer();
  });
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  clearRadiusHandles();

  if (map) {
    map.remove();
    map = null;
  }

  geocoder = null;
  marker = null;
});
</script>

<template>
  <div>
    <v-alert v-if="mapError" type="error" variant="tonal" density="compact" class="mb-3">
      {{ mapError }}
    </v-alert>

    <div class="map-shell">
      <div ref="mapContainer" class="map-container" data-testid="mapbox-container" />
    </div>
  </div>
</template>

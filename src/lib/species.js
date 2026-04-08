function selectLoggerMassG(bodyMassG) {
  if (!Number.isFinite(bodyMassG) || bodyMassG <= 0) {
    return 0.6;
  }
  return bodyMassG > 24 ? 1.2 : 0.6;
}

function loggerMassPercentage(bodyMassG) {
  if (!Number.isFinite(bodyMassG) || bodyMassG <= 0) {
    return 0;
  }

  return (selectLoggerMassG(bodyMassG) / bodyMassG) * 100;
}

function assessSpeciesMass(bodyMassG) {
  if (!Number.isFinite(bodyMassG) || bodyMassG <= 0) {
    return {
      tone: "warning",
      label: "No body mass available.",
      hardFail: false,
      points: 0,
    };
  }

  if (bodyMassG < 12) {
    return {
      tone: "error",
      label: "Species is too light for our loggers.",
      hardFail: true,
      points: 0,
    };
  }

  if (bodyMassG > 100) {
    return {
      tone: "warning",
      label: "Warning: species likely too heavy for this collaboration setup.",
      hardFail: false,
      points: 0,
    };
  }

  if (selectLoggerMassG(bodyMassG) === 0.6) {
    return {
      tone: "warning",
      label: "Species would require a more expensive light-weight logger. We require a stronger justification of novelty.",
      hardFail: false,
      points: 5,
    };
  }

  const loggerPct = loggerMassPercentage(bodyMassG);
  if (loggerPct > 5) {
    return {
      tone: "warning",
      label: "Logger mass exceeds the 5% rule. A stronger justification is required.",
      hardFail: false,
      points: 5,
    };
  }

  return {
    tone: "success",
    label: "Body mass is within the acceptable logger threshold (<= 5%).",
    hardFail: false,
    points: 15,
  };
}

function taggedFeedback(species) {
  if (species.tagged_previously === "light-only") {
    return "Previously tagged with light-level devices: possible, but novelty is reduced.";
  }

  if (species.tagged_previously === "multi-sensor") {
    return `${species.common_name} has already been tagged with multi-sensors. Only projects targeting a distinct population with a different migration route are likely to be considered.`;
  }

  return "Not previously tagged.";
}

export function buildSpeciesFeedback(species) {
  if (!species) {
    return null;
  }

  const mass = assessSpeciesMass(species.body_mass_g);
  const loggerMassG = selectLoggerMassG(species.body_mass_g);
  const loggerPct = loggerMassPercentage(species.body_mass_g);
  const arealTone = species.is_areal ? "warning" : "success";
  const taggedTone =
    species.tagged_previously === "multi-sensor"
      ? "warning"
      : species.tagged_previously === "light-only"
        ? "warning"
        : "success";

  const items = [
    {
      label: "Areal species",
      text: species.is_areal
        ? `${species.common_name} is flagged as areal and is therefore likely not a suitable candidate species for multi-sensor logger.`
        : `${species.common_name} is not flagged as areal feeding species. Pressure-based geolocation is adequate.`,
      tone: arealTone,
    },
    {
      label: "Body mass",
      text: mass.label,
      tone: mass.tone,
      emphasis: {
        weight: Number.isFinite(species.body_mass_g) ? `${species.body_mass_g.toFixed(1)} g` : "No data",
        loggerPct: Number.isFinite(species.body_mass_g) ? `${loggerPct.toFixed(1)}%` : "NA",
        caption: `of body mass (${loggerMassG.toFixed(1)} g logger)`,
      },
    },
    {
      label: "Previously tagged",
      text: taggedFeedback(species),
      tone: taggedTone,
    },
  ];

  let finalTone = "success";
  let finalText = "Strong candidate species for this setup based on current checks.";

  if (mass.hardFail) {
    finalTone = "error";
    finalText = "Not feasible for this setup because body mass is outside the required range.";
  } else if (mass.tone === "warning" || taggedTone === "warning") {
    finalTone = "warning";
    finalText =
      "Possible candidate species, but requires stronger justification on both novelty and feasibility.";
  }

  return {
    title: "Species feasibility checks",
    canContinue: !mass.hardFail,
    items,
    finalTone,
    finalText,
  };
}

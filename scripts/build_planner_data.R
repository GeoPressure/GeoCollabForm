# Build src/data/planner_history.json for the logger planner page.
#
# Usage:
#   Rscript scripts/build_planner_data.R <GDL_Data.accdb | export folder> <sensor_stops.csv>
#
# - GDL_Data.accdb: SOI production database (read with mdbtools, ISO dates), or a
#   folder with GDL_Data.csv and GDL_Orders.csv already exported that way
# - sensor_stops.csv: one row per tag download x sensor, made from the raw files
#   (90_internal_document/sensor_stops/scripts/aggregate.py)
#
# The output is public: it holds no client names, ring numbers, tag IDs,
# coordinates or free-text remarks. Tags are only linked to their order.

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
  library(stringr)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 2) {
  stop("Usage: Rscript scripts/build_planner_data.R <GDL_Data.accdb> <sensor_stops.csv>")
}
access_file <- args[1]
stops_file <- args[2]
out_file <- "src/data/planner_history.json"

read_access_table <- function(table) {
  if (dir.exists(access_file)) {
    return(read_csv(file.path(access_file, paste0(table, ".csv")), show_col_types = FALSE, guess_max = 1e5))
  }
  tmp <- tempfile(fileext = ".csv")
  status <- system2(
    "mdb-export",
    c("-D", "'%Y-%m-%d'", "-T", "'%Y-%m-%d %H:%M:%S'", shQuote(access_file), table),
    stdout = tmp
  )
  if (status != 0) stop("mdb-export failed for ", table)
  read_csv(tmp, show_col_types = FALSE, guess_max = 1e5)
}

gdl <- read_access_table("GDL_Data")
orders_db <- read_access_table("GDL_Orders")

is_test <- function(order) str_detect(order, regex("test|^cal_", ignore_case = TRUE))

# Orders entered as GDL2 that are GDL3pam loggers (sent to the database team for correction)
mislabelled_gdl3 <- c("HirCauJP21", "MerApiPT17", "TurTorCZ20")

# ---- Tags ----------------------------------------------------------------

tags <- gdl |>
  mutate(
    type = case_when(
      str_detect(coalesce(FirmwareVersion, ""), regex("GDL2lp", ignore_case = TRUE)) ~ "GDL2lp",
      GDL_Type == "GDL3pam" ~ "GDL3pam",
      GDL_Type == "GDL2" & OrderName %in% mislabelled_gdl3 ~ "GDL3pam",
      TRUE ~ NA_character_
    )
  ) |>
  filter(!is.na(type), !is_test(OrderName))

cat("Excluded test orders:", paste(sort(unique(gdl$OrderName[is_test(gdl$OrderName)])), collapse = ", "), "\n")

# ---- Battery class ---------------------------------------------------------
#
# The database has no battery field. Each order uses one cell type, so the class
# is set per order (and hardware, harness and light stalk, which some orders mix):
# 1. the cell named in the order remarks (CR1225 large, CR1220 medium, CR1025
#    small, two 1.5 V cells double small);
# 2. otherwise, for v2.x tags with a harness and a light stalk, from the order's
#    median weight with a 3-component Gaussian mixture (double small, medium,
#    large) fitted by EM on the order medians, with the orders of step 1 fixed
#    to their class. The class is kept only when its posterior is >= 0.8;
#    orders in between (glue, tubes and harness add a variable weight) stay
#    unknown. Older hardware (v1.0) and tags without harness or light stalk are
#    lighter by an unknown amount and are only classified from the remarks.
# The weight includes the harness: a CR1225 tag without harness, tubes or
# light stalk weighs 1.5 g, against 1.9-2.3 g with them.

order_cell <- orders_db |>
  group_by(OrderName) |>
  summarise(text = tolower(paste(RemarksProduction, RemarksOrder, HarnessDescription, collapse = " "))) |>
  mutate(
    known = case_when(
      str_detect(text, "2x ?1[.,]5|zwei (parallele )?1[.,]5|renata 337|(zwei|2) kleine batt") ~ "2S",
      str_detect(text, "1225") ~ "L",
      str_detect(text, "1220") ~ "M",
      str_detect(text, "1025") ~ "S",
      TRUE ~ NA_character_
    )
  ) |>
  select(OrderName, known)

tags <- tags |>
  mutate(
    hw = str_to_lower(str_extract(HardwareVersion, regex("v\\d\\.\\d", ignore_case = TRUE))),
    weight = round(TotalWeight, 2),
    harness = recode(Harness, "leg harness" = "leg", "breast harness" = "breast", .default = Harness),
    lwl = as.integer(LWL),
    lwl_length = if_else(lwl == 1, LWL_Length, NA_real_),
    has_data = !is.na(UTC_LastData) | !is.na(DateDownload),
    id = GDL_ID
  ) |>
  left_join(order_cell, by = "OrderName")

battery_groups <- tags |>
  filter(type == "GDL3pam") |>
  group_by(OrderName, hw, harness, lwl, known) |>
  summarise(n = n(), med = median(weight, na.rm = TRUE), .groups = "drop") |>
  mutate(fit = !is.na(med) & hw != "v1.0" & harness %in% c("leg", "breast") & lwl == 1)

mixture_classes <- c("2S", "M", "L")
min_posterior <- 0.8
fit_battery_mixture <- function(x, fixed, mu = c(1.1, 1.45, 2.05), iters = 500) {
  k <- length(mu)
  s <- rep(0.1, k)
  p <- rep(1 / k, k)
  dens <- function(x) sapply(seq_len(k), function(j) p[j] * dnorm(x, mu[j], s[j]))
  for (i in seq_len(iters)) {
    r <- dens(x)
    r <- r / rowSums(r)
    r[!is.na(fixed[, 1]), ] <- fixed[!is.na(fixed[, 1]), ]
    nk <- colSums(r)
    p <- nk / length(x)
    mu <- colSums(r * x) / nk
    s <- pmax(sqrt(colSums(r * (x - rep(mu, each = length(x)))^2) / nk), 0.03)
  }
  list(mu = mu, sd = s, p = p, posterior = function(x) { d <- dens(x); d / rowSums(d) })
}

fit_set <- filter(battery_groups, fit)
fixed <- t(vapply(
  fit_set$known,
  function(k) if (is.na(k) || !(k %in% mixture_classes)) rep(NA_real_, 3) else as.numeric(mixture_classes == k),
  numeric(3)
))
mixture <- fit_battery_mixture(fit_set$med, fixed)
post <- mixture$posterior(coalesce(battery_groups$med, 0))
battery_groups <- battery_groups |>
  mutate(
    p_max = if_else(is.na(med), NA_real_, apply(post, 1, max)),
    mixture_class = mixture_classes[max.col(post, ties.method = "first")],
    battery = case_when(
      !is.na(known) ~ known,
      fit & p_max >= min_posterior ~ mixture_class,
      TRUE ~ NA_character_
    ),
    battery_source = case_when(!is.na(known) ~ "remarks", !is.na(battery) ~ "weight", TRUE ~ NA_character_)
  )
cat(
  "Battery mixture (2S, M, L): mean", round(mixture$mu, 3), "sd", round(mixture$sd, 3), "\n",
  "Orders by class:", paste(names(table(battery_groups$battery, useNA = "ifany")), table(battery_groups$battery, useNA = "ifany"), collapse = ", "), "\n"
)

tags <- tags |>
  left_join(select(battery_groups, OrderName, hw, harness, lwl, battery, battery_source), by = c("OrderName", "hw", "harness", "lwl")) |>
  mutate(
    battery = if_else(type == "GDL2lp", "LP", battery),
    battery_source = if_else(type == "GDL2lp", "type", battery_source)
  )

# ---- Downloads and sensors (from the raw files) ---------------------------

sensor_names <- c(
  glf = "light", pressure = "pressure", acceleration = "acc", airtemperature = "airT",
  temperature = "airT", bodytemperature = "bodyT", magnetic = "mag"
)
bytes_per_sample <- c(light = 2, pressure = 2, acc = 2, airT = 1, bodyT = 1, mag = 13)

stops <- read_csv(stops_file, show_col_types = FALSE) |>
  filter(!test, !is_test(order)) |>
  mutate(
    sensor = unname(sensor_names[sensor]),
    id = str_remove(tag, "_.*$"),
    type = if_else(str_detect(fw, "GDL2lp"), "GDL2lp", "GDL3pam"),
    hw = str_to_lower(str_extract(hw, regex("v\\d\\.\\d", ignore_case = TRUE))),
    mem = as.numeric(mem)
  )

# Memory model: each sensor gets a share of the pages proportional to its data rate,
# 224 usable bytes per 256-byte page (208 for the magnetometer)
stops <- stops |>
  group_by(order, tag) |>
  mutate(
    rate = bytes_per_sample[sensor] / interval_min,
    usable = if_else(sensor == "mag", 208, 224),
    pred_mem_days = (mem / 256) * rate / sum(rate) * usable / rate / 1440
  ) |>
  ungroup()

downloads <- stops |>
  group_by(order, tag, id, type, hw, fw, mem, base) |>
  summarise(
    start = min(logging_start),
    tag_end = max(last_valid),
    ref = first(stop_ref),
    spread = as.numeric(difftime(max(last_valid), min(last_valid), units = "days")),
    gap_ref = as.numeric(difftime(first(stop_ref), max(last_valid), units = "days")),
    days = as.numeric(difftime(max(last_valid), min(logging_start), units = "days")),
    batlow = any(batlow),
    memerr = any(memerr),
    .groups = "drop"
  ) |>
  filter(days > 1) |>
  # A tag read twice (e.g. a short file after a restart) keeps its longest record
  group_by(order, id) |>
  slice_max(days, n = 1, with_ties = FALSE) |>
  ungroup() |>
  # How the record ends, from the last sensor to stop: still logging at read-back (A)
  # or stopped before it (B). Sensors often stop a few days apart when the battery
  # runs out, and a sensor whose memory share is full stops earlier by design, so
  # the spread between sensors is not used.
  mutate(
    end_type = case_when(
      gap_ref <= 2 ~ "A",
      gap_ref > 2 ~ "B",
      TRUE ~ "other"
    )
  )

stops <- stops |>
  semi_join(downloads, by = c("order", "tag")) |>
  mutate(early = gap_to_tag_end_days > 2)

# ---- Link tags, downloads and orders --------------------------------------

# Tags found only in the raw files (no row in GDL_Data) are kept as their own tag
extra_tags <- downloads |>
  anti_join(tags, by = c("order" = "OrderName", "id")) |>
  distinct(OrderName = order, id, type, hw) |>
  mutate(battery = if_else(type == "GDL2lp", "LP", NA_character_), battery_source = if_else(type == "GDL2lp", "type", NA_character_), has_data = TRUE)

tags <- bind_rows(tags, extra_tags) |>
  distinct(OrderName, id, .keep_all = TRUE) |>
  arrange(OrderName, id) |>
  mutate(tag_idx = row_number() - 1)

downloads <- downloads |>
  inner_join(tags |> select(OrderName, id, tag_idx), by = c("order" = "OrderName", "id")) |>
  arrange(tag_idx, start) |>
  mutate(dl_idx = row_number() - 1)

stops <- stops |>
  inner_join(downloads |> select(order, tag, dl_idx), by = c("order", "tag"))

mode_chr <- function(x) {
  x <- x[!is.na(x) & x != ""]
  if (length(x) == 0) return(NA_character_)
  names(sort(table(x), decreasing = TRUE))[1]
}

# Settings per order: the raw-file settings if any, else the production database
db_intervals <- tags |>
  filter(!is.na(BaseLoggingInterval)) |>
  group_by(OrderName) |>
  summarise(
    base = as.numeric(mode_chr(BaseLoggingInterval)),
    light = as.numeric(mode_chr(IntervalFactorLight)),
    pressure = as.numeric(mode_chr(IntervalFactorPressure)),
    airT = as.numeric(mode_chr(IntervalFactorAirTemperature)),
    bodyT = as.numeric(mode_chr(IntervalFactorBodyTemperature)),
    acc = as.numeric(mode_chr(IntervalFactorAcceleration)),
    mag = as.numeric(mode_chr(IntervalFactorMagnetic)),
    .groups = "drop"
  ) |>
  mutate(across(light:mag, \(f) if_else(f > 0, f * base, NA_real_)))

raw_intervals <- stops |>
  group_by(order, sensor) |>
  summarise(interval = as.numeric(mode_chr(interval_min)), .groups = "drop") |>
  tidyr::pivot_wider(names_from = sensor, values_from = interval)

species_by_order <- tags |>
  group_by(OrderName) |>
  summarise(species = mode_chr(str_squish(Species)), .groups = "drop")

# Species names: keep the GDL_Data value when it is a known species, else take the
# GDL_Orders value, else decode the order name (e.g. "ApuApu" -> Apus apus)
known_species <- read_csv("src/data/avilist_soi_avonet_joined.csv", show_col_types = FALSE)$scientific_name
species_code <- tibble(scientific_name = known_species) |>
  mutate(code = paste0(str_sub(word(scientific_name, 1), 1, 3), str_to_title(str_sub(word(scientific_name, 2), 1, 3)))) |>
  group_by(code) |>
  filter(n() == 1) |>
  ungroup()
species_by_order <- species_by_order |>
  left_join(orders_db |> group_by(OrderName) |> summarise(species_order = mode_chr(str_squish(Species))), by = "OrderName") |>
  mutate(
    code_species = species_code$scientific_name[match(str_sub(OrderName, 1, 6), species_code$code)],
    species = case_when(
      species %in% known_species ~ species,
      species_order %in% known_species ~ species_order,
      !is.na(code_species) ~ code_species,
      !is.na(species) ~ species,
      TRUE ~ species_order
    )
  ) |>
  select(OrderName, species)

# Order names that the rules above cannot decode
species_manual <- c(
  FicAlbCZ25 = "Ficedula albicollis",
  OeOeAcDE16 = "Oenanthe oenanthe",
  TaMeCHAc17 = "Tachymarptis melba",
  TaMeCHBr15 = "Tachymarptis melba"
)
species_by_order <- species_by_order |>
  full_join(tibble(OrderName = names(species_manual), manual = unname(species_manual)), by = "OrderName") |>
  mutate(species = coalesce(manual, species)) |>
  select(-manual)

orders <- tags |>
  group_by(order = OrderName) |>
  summarise(
    type = mode_chr(type),
    hw = mode_chr(hw),
    n_tags = n(),
    n_data = sum(has_data, na.rm = TRUE),
    harness = mode_chr(harness),
    .groups = "drop"
  ) |>
  left_join(species_by_order, by = c("order" = "OrderName")) |>
  mutate(
    year = 2000 + as.integer(str_extract(order, "\\d{2}")),
    country = str_match(order, "^[A-Z][a-z]{2}[A-Z][a-z]{2}([A-Z]{2})")[, 2]
  ) |>
  left_join(
    raw_intervals |> rename_with(\(x) paste0("raw_", x), -order),
    by = "order"
  ) |>
  left_join(
    db_intervals |> rename_with(\(x) paste0("db_", x), -OrderName),
    by = c("order" = "OrderName")
  )

sensors_all <- c("light", "pressure", "airT", "acc", "mag", "bodyT")
for (s in sensors_all) {
  raw_col <- paste0("raw_", s)
  if (!raw_col %in% names(orders)) orders[[raw_col]] <- NA_real_
  orders[[s]] <- if_else(!is.na(orders[[raw_col]]), orders[[raw_col]], orders[[paste0("db_", s)]])
}
orders <- orders |>
  mutate(base = db_base, settings_source = if_else(!is.na(raw_light) | !is.na(raw_pressure), "files", "database")) |>
  select(order, species, country, year, type, hw, n_tags, n_data, harness, base, all_of(sensors_all), settings_source) |>
  arrange(order) |>
  mutate(order_idx = row_number() - 1)

tags <- tags |> left_join(orders |> select(order, order_idx), by = c("OrderName" = "order"))

# ---- Write ----------------------------------------------------------------

na_to_null <- function(x) if (is.numeric(x)) round(x, 2) else x

out <- list(
  generated = format(Sys.Date()),
  source = "SOI GDL production database and raw logger files; test orders excluded",
  battery_mixture = list(
    classes = mixture_classes,
    mean = round(mixture$mu, 3),
    sd = round(mixture$sd, 3),
    min_posterior = min_posterior
  ),
  orders = orders |> select(-order_idx),
  tags = list(
    order = tags$order_idx,
    type = tags$type,
    hw = tags$hw,
    battery = tags$battery,
    battery_source = tags$battery_source,
    harness = tags$harness,
    lwl = tags$lwl,
    lwl_length = tags$lwl_length,
    weight = tags$weight,
    has_data = tags$has_data
  ),
  downloads = list(
    tag = downloads$tag_idx,
    hw = downloads$hw,
    mem = downloads$mem,
    days = na_to_null(downloads$days),
    end_type = downloads$end_type,
    batlow = downloads$batlow,
    memerr = downloads$memerr
  ),
  sensors = list(
    download = stops$dl_idx,
    sensor = stops$sensor,
    interval = stops$interval_min,
    days = na_to_null(stops$days_logged),
    pred_mem_days = na_to_null(stops$pred_mem_days),
    early = stops$early
  )
)

write_json(out, out_file, auto_unbox = TRUE, na = "null", digits = NA, dataframe = "rows")
cat(
  "Wrote", out_file, ":", nrow(orders), "orders,", nrow(tags), "tags,",
  nrow(downloads), "downloads,", nrow(stops), "sensor records\n"
)

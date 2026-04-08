import { parseCsv } from './csv'

function parseNumber(value) {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseBoolean(value) {
  return String(value || '').trim().toLowerCase() === 'true'
}

function buildBowUrl(ebirdCode, bowUrl, scientificName) {
  const direct = (bowUrl || '').trim()
  if (direct) {
    return direct
  }

  const code = (ebirdCode || '').trim().toLowerCase()
  if (code) {
    return `https://birdsoftheworld.org/bow/species/${encodeURIComponent(code)}`
  }

  return `https://birdsoftheworld.org/bow/speciessearch?query=${encodeURIComponent(scientificName || '')}`
}

function parseTagged(taggedCell, soiRaw) {
  const tagged = (taggedCell || '').trim().toLowerCase()
  if (tagged === 'multi-sensor' || tagged === 'light-only') {
    return tagged
  }

  if ((soiRaw || '').trim()) {
    return 'multi-sensor'
  }

  return ''
}

export function parseSpeciesRecordsFromJoinedCsv(csvRaw) {
  const rows = parseCsv(csvRaw)
  if (rows.length === 0) {
    return []
  }

  const headers = rows[0].map((header) => header.trim())
  const headerIndex = new Map(headers.map((header, idx) => [header, idx]))

  function cell(row, name) {
    const idx = headerIndex.get(name)
    if (idx === undefined) return ''
    return (row[idx] || '').trim()
  }

  const byAvibaseId = new Map()

  for (const row of rows.slice(1)) {
    const avibaseId = cell(row, 'avibase_id').toUpperCase()
    const scientificName = cell(row, 'scientific_name')
    const commonName = cell(row, 'common_name') || scientificName

    const bodyMass = parseNumber(cell(row, 'body_mass_g'))

    if (!avibaseId || !scientificName) {
      continue
    }

    const taggedPreviously = parseTagged(
      cell(row, 'tagged_previously'),
      cell(row, 'soi_number_loggers_approx_raw')
    )

    byAvibaseId.set(avibaseId, {
      avibase_id: avibaseId,
      ebird_species_code: cell(row, 'ebird_species_code'),
      birds_of_the_world_url: buildBowUrl(
        cell(row, 'ebird_species_code'),
        cell(row, 'birds_of_the_world_url'),
        scientificName
      ),
      order_name: cell(row, 'order_name'),
      family_name: cell(row, 'family_name'),
      common_name: commonName,
      scientific_name: scientificName,
      is_areal: parseBoolean(cell(row, 'is_areal')),
      soi_number_loggers_approx_raw: cell(row, 'soi_number_loggers_approx_raw'),
      body_mass_g: bodyMass,
      tagged_previously: taggedPreviously
    })
  }

  return [...byAvibaseId.values()].sort((a, b) => {
    const nameCompare = a.common_name.localeCompare(b.common_name)
    if (nameCompare !== 0) return nameCompare
    return a.scientific_name.localeCompare(b.scientific_name)
  })
}

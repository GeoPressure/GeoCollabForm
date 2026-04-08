export function createDefaultFormDraft() {
  return {
    species: {
      avibase_id: ''
    },
    location: {
      country: '',
      site_name: '',
      latitude: null,
      longitude: null,
      radius_km: 20
    },
    project: {
      project_description: '',
      expected_number_equipped: null,
      recapture_rationale: '',
      permits_status_text: ''
    },
    contact: {
      full_name: '',
      email: '',
      affiliation: '',
      address: '',
      comments: ''
    }
  }
}

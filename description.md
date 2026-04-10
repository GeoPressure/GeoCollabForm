GeoCollab Form

Project setup and implementation outline

1. Purpose of the form

The GeoCollab form is a web-based collaboration intake form for the Swiss Ornithological Institute. It serves two purposes at the same time:

First, it helps potential collaborators assess whether their project is broadly compatible with the requirements of a geolocator collaboration.

Second, it collects structured information about each proposed project so the Swiss Ornithological Institute can later review, compare, rank, and follow up on submissions.

The collaboration model is that the Swiss Ornithological Institute provides multi-sensor geolocators, while the external collaborator is responsible for field deployment on birds and for the local project context.

For a project to be considered feasible, the following conditions are generally required:
• sufficient capture potential, ideally more than 10 individuals
• sufficient probability of recapture, since birds must be recaptured to recover the devices
• at least 3 years of commitment
• valid ringing licence and capacity to obtain all required permits for deployment
• preferably a link with a local institution or organization
• preferably prior experience with ringing, ideally with the focal species

The form should therefore function both as:
• a guided feasibility screening tool for the applicant
• a structured project intake system for internal review

⸻

2. Recommended technical setup

Frontend
• Vue 3
• Vite
• Vuetify
• Mapbox GL JS + Mapbox geocoder/search

Backend / storage
• Google Sheets (via Apps Script)

Hosting
• GitHub Pages

⸻

1. Core product behavior

The form should be a multi-step wizard rather than a long single-page form.

This is important because the user should get feedback progressively. For example:
• species feedback immediately after species selection
• recapture warnings once project details are entered
• an overall provisional fit assessment before submission

The form should also compute an internal preliminary assessment based on key criteria. This is not a final decision, but a first-pass compatibility signal.

⸻

4. Main sections of the form

Section 1. Species

Goal

Collect the focal species and give immediate feedback on species suitability.

Input

A searchable select field with:
• common name
• scientific name

Data source

A local species dataset bundled with the website. Each species entry should include at least:
• avibase_id
• common_name
• scientific_name
• body_mass_g
• priority_species: 1, 2, 3
• tagged_previously: "light-only", "multi-sensor", "" (not)

Draft logic

First body_mass_g:
• < 12 g → Not possible (cannot continue)
• 12 to < 30 g → Possible but quite light for multi-sensor (continue)
• 30 to 100 g → Great species (continue)
• > 100 g → Not really suitable for a geolocator (cannot continue)

Then tagged_previously:

- "" : great (continue)
- "light-only" (already equipped with light-level) orange, but continue
- "multi-sensor" (already equipped) orange, but continue

Then priority_species:

- 1: not really of interest (orange, continue)
- 2: Strong candidate (green, continue)
- 3: Strong interest, we really want this! (green, continue)

UI component suggestion
• v-autocomplete
• a v-alert or v-card below showing the message

⸻

Section 2. Location

Goal

Collect clear structured information about the deployment site.

Input fields
• country
• site name
• location search
• map point + radius of study area

Map behavior

The user should be able to:
• search a location using Mapbox
• place or confirm a point on the map
• define an approximate radius of the study area

• Placing the center

- drag the circle edge (four corners)

- input for location name (pre-filled based on search/location)
- country (pre-filled, but editable)

- Based on continent/country, we would display a message: Region of interest (anything outside north-western Europe)

⸻

Section 3. Project details

Goal

Assess practical feasibility of the proposed collaboration.

Input fields
• project title or short project name
• project description
• expected start date
• expected end date
• expected deployment duration
• expected number of birds captured
• expected number of birds equipped
• ringing licence and permit details
• description of ringing experience
• proof or rationale for recapture
• season or annual stage of deployment
• whether permits are already secured, planned, or unknown

Strongly recommended structured fields

In addition to text boxes, this section should include some structured questions.

Capture and recapture
• expected number captured
• expected number equipped
• expected number recaptured, if they can estimate it
• deployment context:
• breeding
• wintering
• migration
• resident / other
• recapture confidence:
• high
• medium
• low

Permits and licences
• do you currently hold a ringing licence?
• do you expect to obtain the required deployment permit?
• are ethical approvals required?
• current permit status:
• already secured
• in preparation
• planned
• unknown

Experience
• have you ringed this species before?
• do you have general ringing experience?
• have you deployed tags or geolocators before?

⸻

Section 4. Contact information

Goal

Provide contact and affiliation details for follow-up.

Input fields
• full name
• email
• affiliation
• department or lab, if relevant
• country
• website or profile, optional
• additional comments or questions

Stored fields
• contact_name
• contact_email
• affiliation
• country_contact
• website
• comments

⸻

Section 5. Review and submission

Goal

Give the applicant a final overview before submission.

Review summary shown to the user
• species assessment
• location summary
• project feasibility summary
• warnings or missing elements
• overall provisional fit

Example provisional fit categories
• Strong fit
• Plausible but needs discussion
• Unlikely fit
• Insufficient information

This step is very useful, because it makes the form feel helpful rather than purely administrative.

Recommended page structure

Overall layout

I would use a centered, medium-width layout:
• max width around 800 to 1000 px
• generous whitespace
• one main card/panel per step
• sticky step indicator at top if possible

This keeps it readable and serious.

Suggested structure per step

Each step should have:

Top
• short title
• one-sentence explanation

Middle
• the actual fields

Bottom
• feedback box or warning if relevant
• back / continue buttons

That pattern should stay the same across all steps.

Visual style

Tone

Given the Swiss Ornithological Institute context, I would aim for:
• professional
• calm
• field-science / nature adjacent
• clean rather than flashy

Good style direction
• neutral background
• one main accent color
• one warning color
• one success/info color
• restrained use of icons
• subtle elevation/shadows only

Avoid
• overly colorful gradients
• heavy animations
• dashboard-like clutter
• too many chips/badges everywhere
• dense text walls

    Color guidelines

A good palette would be:
• Primary: muted blue or deep green
• Success/info: soft green
• Warning: amber
• Error/not suitable: muted red
• Background: very light grey or off-white
• Text: dark neutral grey

This works well with both scientific credibility and nature context.

Use colors semantically

For example:
• Great species → green
• Possible but not ideal → amber
• Not ideal → orange/red
• Not possible → red

But do not rely on color only. Always include a label.

Typography guidelines

Use a very standard, readable sans-serif

Nothing decorative.

Good qualities:
• clean
• neutral
• strong legibility on forms

Hierarchy

Keep hierarchy simple:
• page title
• step title
• section label
• helper text
• field label

Do not use too many font sizes.

Helper text

Use small muted helper text under fields only when it truly helps.

Example:
• “Select the focal species for the proposed deployment.”

Avoid long paragraphs of instructions.

⸻

Wizard / stepper guidelines

Keep the number of steps visible

Show 5 steps clearly: 1. Species 2. Location 3. Project 4. Contact 5. Review

This helps users understand the effort required.

Mark progress clearly

Users should always know:
• where they are
• what comes next
• how much is left

Make navigation predictable
• Back button always available
• Continue button always bottom right
• disabled only when a truly required field is missing

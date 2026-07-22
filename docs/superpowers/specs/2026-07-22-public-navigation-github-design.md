# Public Navigation and GitHub Link Design

## Goal

Make Sadar Bencana's public safety workflows visible immediately on desktop and mobile, while clearly identifying the application as open source.

## Scope

- Promote `Overview`, `Early Warning`, `Evakuasi`, and `Belajar Siaga` into primary navigation.
- Replace ambiguous overflow symbols with a labeled Menu control.
- Add a visible GitHub/Open Source link to the official repository.
- Keep all existing application sections reachable.
- Preserve the current single-page section navigation and authorization behavior.

No API, database, authentication, or deployment configuration changes are included.

## Information Architecture

### Desktop header

The fixed header keeps the brand at the left and presents these primary destinations in order:

1. `Overview` (opens the existing `Executive Overview` section)
2. `Early Warning`
3. `Evakuasi` (opens the existing `Lokasi Evakuasi` section)
4. `Belajar Siaga`
5. `Menu`

The right side contains a `GitHub` button with an `Open Source` supporting label. It opens `https://github.com/setiyadinamikaintegrasi/sadar-bencana` in a new tab.

The Menu dropdown groups secondary sections for scanning:

- `Pemantauan`: Events, Alerts, Source Health, Riwayat Wilayah
- `Analisis`: Daftar Risiko, Briefing, AI Copilot
- `Administrasi`: Sumber Resmi, Admin EWS, Admin Evakuasi

### Mobile navigation

The bottom navigation contains five stable destinations:

1. `Overview`
2. `Early Warning`
3. `Evakuasi`
4. `Belajar`
5. `Menu`

The mobile header shows the current section and a compact GitHub button. The Menu bottom sheet uses the same groups as desktop, remains vertically scrollable on short viewports, and keeps the close action reachable.

## Components

- A shared navigation configuration owns section labels, display labels, Lucide icons, placement, and grouping. `App` and `TopNav` consume this source to avoid menu drift.
- `TopNav` renders the desktop primary navigation, grouped menu, active state, and external GitHub action.
- `App` renders the mobile header, bottom navigation, and grouped menu sheet from the shared configuration.
- Existing section rendering remains unchanged.

## Interaction And Accessibility

- Use Lucide icons instead of text glyphs.
- Active destinations have a visible color and border state; inactive destinations retain sufficient contrast.
- Menu controls expose `aria-expanded`, `aria-controls`, and clear accessible names.
- Desktop Menu closes after selection, outside click, or Escape.
- Mobile Menu closes after selection, backdrop click, or close action.
- The GitHub link uses `target="_blank"` and `rel="noreferrer"` and has an accessible label that identifies it as the open-source repository.
- Fixed navigation dimensions remain stable across active, hover, and focus states.

## Responsive Behavior

- Desktop navigation appears at the existing `md` breakpoint.
- Labels remain compact enough for common laptop widths; the GitHub supporting label may hide before the entire control does.
- Mobile bottom items use fixed equal-width tracks so label or icon changes do not shift layout.
- The menu sheet has a bounded height and internal scrolling to avoid clipping content.

## Verification

- Component tests verify primary menu order, active states, Menu behavior, grouped secondary links, and GitHub URL/security attributes.
- App tests verify mobile destination routing and Menu sheet behavior.
- TypeScript build and existing frontend tests must pass.
- Browser verification covers desktop and mobile screenshots, keyboard operation, no content overlap, and the GitHub link target.

## Rollout

This is a frontend-only release. The web image can be rebuilt and restarted independently. Rollback uses the previous web image or previous Git commit; no data rollback is required.

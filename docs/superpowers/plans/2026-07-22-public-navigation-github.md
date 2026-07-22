# Public Navigation and GitHub Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Sadar Bencana's public safety workflows into immediately visible navigation and add a visible link to the official open-source GitHub repository.

**Architecture:** Move navigation metadata into one typed module consumed by desktop and mobile renderers. Keep section state and page rendering in `App`, while `TopNav` owns desktop interactions and an accessible grouped overflow menu. Add focused component tests before implementation, then verify the built UI at desktop and mobile viewports.

**Tech Stack:** React 18, TypeScript 6, Tailwind CSS 4, lucide-react, Vitest, Testing Library, Vite.

## Global Constraints

- Primary desktop order is `Overview`, `Early Warning`, `Evakuasi`, `Belajar Siaga`, `Menu`.
- Primary mobile order is `Overview`, `Early Warning`, `Evakuasi`, `Belajar`, `Menu`.
- GitHub target is exactly `https://github.com/setiyadinamikaintegrasi/sadar-bencana` and opens in a new tab with `rel="noreferrer"`.
- All existing sections remain reachable and existing authorization behavior remains unchanged.
- No API, database, authentication, or deployment configuration changes.
- Use Lucide icons and stable fixed navigation dimensions.

---

### Task 1: Shared Navigation Model

**Files:**
- Create: `apps/web/src/navigation.ts`
- Test: `apps/web/src/navigation.test.ts`

**Interfaces:**
- Produces: `Section`, `PRIMARY_NAV_ITEMS`, `SECONDARY_NAV_GROUPS`, `GITHUB_REPOSITORY_URL`, and `findNavigationItem(section)`.
- Consumes: Lucide `LucideIcon` type and icon components.

- [ ] **Step 1: Write the failing navigation model test**

```ts
import { describe, expect, it } from 'vitest'
import {
  GITHUB_REPOSITORY_URL,
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_GROUPS,
} from './navigation'

describe('navigation model', () => {
  it('prioritizes public safety workflows without dropping secondary sections', () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.desktopLabel)).toEqual([
      'Overview', 'Early Warning', 'Evakuasi', 'Belajar Siaga',
    ])
    expect(SECONDARY_NAV_GROUPS.map((group) => group.label)).toEqual([
      'Pemantauan', 'Analisis', 'Administrasi',
    ])
    expect(SECONDARY_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.section)))
      .toEqual(expect.arrayContaining(['Events', 'Alerts', 'Daftar Risiko', 'Sumber Resmi']))
  })

  it('uses the official open-source repository URL', () => {
    expect(GITHUB_REPOSITORY_URL).toBe(
      'https://github.com/setiyadinamikaintegrasi/sadar-bencana',
    )
  })
})
```

- [ ] **Step 2: Run the test and confirm the module is missing**

Run: `npm run test --workspace apps/web -- src/navigation.test.ts`

Expected: FAIL because `./navigation` does not exist.

- [ ] **Step 3: Implement the typed navigation model**

Create a `Section` union containing every current section, a `NavigationItem` type with `section`, `desktopLabel`, `mobileLabel`, and `icon`, and these constants:

```ts
export const GITHUB_REPOSITORY_URL =
  'https://github.com/setiyadinamikaintegrasi/sadar-bencana'

export const PRIMARY_NAV_ITEMS = [
  { section: 'Executive Overview', desktopLabel: 'Overview', mobileLabel: 'Overview', icon: LayoutDashboard },
  { section: 'Early Warning', desktopLabel: 'Early Warning', mobileLabel: 'Early Warning', icon: Siren },
  { section: 'Lokasi Evakuasi', desktopLabel: 'Evakuasi', mobileLabel: 'Evakuasi', icon: MapPinned },
  { section: 'Belajar Siaga', desktopLabel: 'Belajar Siaga', mobileLabel: 'Belajar', icon: GraduationCap },
] as const satisfies readonly NavigationItem[]
```

Define `SECONDARY_NAV_GROUPS` with the exact three groups and all remaining sections from the design. Implement `findNavigationItem` by searching primary items and flattened secondary items.

- [ ] **Step 4: Run the model test**

Run: `npm run test --workspace apps/web -- src/navigation.test.ts`

Expected: PASS.

---

### Task 2: Accessible Desktop Navigation

**Files:**
- Modify: `apps/web/src/components/TopNav.tsx`
- Create: `apps/web/src/components/TopNav.test.tsx`

**Interfaces:**
- Consumes: `Section`, `PRIMARY_NAV_ITEMS`, `SECONDARY_NAV_GROUPS`, and `GITHUB_REPOSITORY_URL` from `navigation.ts`.
- Produces: unchanged `TopNav({ activeSection, onNavigate })` component contract with `activeSection: Section`.

- [ ] **Step 1: Write failing desktop navigation tests**

Cover these observable behaviors with Testing Library:

```tsx
render(<TopNav activeSection="Early Warning" onNavigate={onNavigate} />)
expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeTruthy()
expect(screen.getByRole('button', { name: 'Early Warning' }).getAttribute('aria-current')).toBe('page')
const github = screen.getByRole('link', { name: /GitHub.*Open Source/i })
expect(github.getAttribute('href')).toBe(GITHUB_REPOSITORY_URL)
expect(github.getAttribute('target')).toBe('_blank')
```

Click `Menu`, assert `aria-expanded="true"`, assert group headings and secondary destinations, then click `Events` and verify `onNavigate('Events')` and menu closure. Add an Escape-key test.

- [ ] **Step 2: Run the desktop test and confirm failure**

Run: `npm run test --workspace apps/web -- src/components/TopNav.test.tsx`

Expected: FAIL because current navigation uses glyphs, has no labeled Menu, grouping, GitHub link, or ARIA state.

- [ ] **Step 3: Implement desktop rendering**

Replace local tab arrays with the shared model. Render Lucide icons at stable `h-4 w-4`, label the navigation `Navigasi utama`, render `Menu` with `Menu`/`ChevronDown` icons and `aria-expanded`, and group dropdown entries under visible compact headings. Add a document keydown effect that closes the menu on Escape. Render a right-aligned GitHub link using the Lucide `Github` icon, `target="_blank"`, and `rel="noreferrer"`.

- [ ] **Step 4: Run desktop tests**

Run: `npm run test --workspace apps/web -- src/components/TopNav.test.tsx`

Expected: PASS.

---

### Task 3: Public-First Mobile Navigation

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: shared navigation model and GitHub URL.
- Preserves: existing section rendering, official alert map focus, and auth gates.

- [ ] **Step 1: Add failing mobile navigation tests**

Extend `App.test.tsx` to assert that the primary mobile navigation contains `Overview`, `Early Warning`, `Evakuasi`, `Belajar`, and `Menu`; clicking `Early Warning` renders the existing EWS section; the mobile GitHub link has the official URL and secure external-link attributes; and the Menu sheet exposes all three grouped secondary areas.

- [ ] **Step 2: Run the App test and confirm failure**

Run: `npm run test --workspace apps/web -- src/App.test.tsx`

Expected: FAIL because mobile still exposes Events and Alerts as primary tabs and lacks GitHub.

- [ ] **Step 3: Implement mobile header, bottom navigation, and sheet**

Remove duplicated `sections`, `bottomTabs`, and `moreSections` arrays. Use `Section` and shared navigation items, render Lucide icons in equal-width bottom items, add a compact GitHub link in the mobile header, and render grouped secondary items in a `max-h-[80vh] overflow-y-auto` sheet. Preserve backdrop and close-button behavior and add `aria-label="Navigasi mobile"`.

- [ ] **Step 4: Run App and navigation tests**

Run: `npm run test --workspace apps/web -- src/App.test.tsx src/components/TopNav.test.tsx src/navigation.test.ts`

Expected: PASS.

---

### Task 4: Regression And Visual Verification

**Files:**
- Modify only if verification reveals a defect in files from Tasks 1-3.

**Interfaces:**
- Validates the complete frontend deliverable.

- [ ] **Step 1: Run the full frontend suite and production build**

Run:

```bash
npm run test --workspace apps/web
npm run build --workspace apps/web
```

Expected: all Vitest tests pass and Vite produces `apps/web/dist` without TypeScript errors.

- [ ] **Step 2: Start the local application and inspect desktop**

Run `./start.sh`, open `http://127.0.0.1:3001`, and capture a 1440x900 screenshot. Verify all primary desktop labels and GitHub are visible without overlap, Menu opens, groups are readable, and active state is clear.

- [ ] **Step 3: Inspect mobile**

Capture a 390x844 screenshot. Verify five stable bottom tracks, GitHub in the header, no text clipping, the Menu sheet scrolls, and page content remains above the bottom navigation.

- [ ] **Step 4: Verify keyboard and external link behavior**

Tab through primary navigation, open Menu with keyboard, close with Escape, and confirm the GitHub link points to the exact repository with a new-tab target.

- [ ] **Step 5: Review and commit implementation**

Run `git diff --check`, inspect the scoped diff, then commit only navigation implementation and tests with:

```bash
git add apps/web/src/navigation.ts apps/web/src/navigation.test.ts \
  apps/web/src/components/TopNav.tsx apps/web/src/components/TopNav.test.tsx \
  apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat(web): promote public safety navigation"
```

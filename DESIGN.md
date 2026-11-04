---
name: Neat for Echo Spirits
description: A precise, approachable field and comparison workspace with Echo character.
colors:
  action: "#885731"
  action-hover: "#6d4426"
  accent-2: "#1b7567"
  accent-soft: "#e4f5f1"
  bg: "#f3f5f4"
  bg-2: "#ecefee"
  panel: "#ffffff"
  panel-2: "#f2f4f3"
  panel-3: "#e5eae8"
  text: "#283138"
  muted: "#59656b"
  muted-2: "#46545a"
  line: "#d5ddda"
  line-strong: "#7c878e"
  success: "#28654b"
  danger: "#b8342b"
  warning: "#805710"
  success-surface: "#e9f4ee"
  success-ink: "#28654b"
  warning-surface: "#fcf3df"
  warning-ink: "#805710"
  danger-surface: "#fcece9"
  danger-ink: "#a32c24"
  info-surface: "#eaf2f7"
  info-ink: "#275f83"
  teal-surface: "#e4f5f1"
  teal-ink: "#1b6b5d"
  purple-surface: "#f0edf5"
  purple-ink: "#614578"
  dark-bg: "#172126"
  dark-bg-2: "#1b272c"
  dark-panel: "#202c31"
  dark-panel-2: "#29373d"
  dark-panel-3: "#35464d"
  dark-text: "#eff3f2"
  dark-muted: "#b5c3c5"
  dark-muted-2: "#c7d1d2"
  dark-line: "#40535a"
  dark-line-strong: "#72898f"
  dark-action-hover: "#a2673a"
  dark-accent: "#e5b58f"
  dark-accent-hover: "#f5d0b0"
  dark-accent-2: "#76d5c3"
  dark-accent-soft: "#23443d"
  dark-success-surface: "#293e2f"
  dark-success-ink: "#b5e3bf"
  dark-warning-surface: "#443820"
  dark-warning-ink: "#f5d28e"
  dark-danger-surface: "#49302e"
  dark-danger-ink: "#ffb4ad"
  dark-info-surface: "#293b51"
  dark-info-ink: "#bad8ff"
  dark-teal-surface: "#263e3e"
  dark-teal-ink: "#a6dedb"
  dark-purple-surface: "#3c304b"
  dark-purple-ink: "#ddc6f4"
  sidebar-surface: "#283138"
  sidebar-raised: "#34434a"
  sidebar-muted: "#becbce"
  sidebar-line: "#52646b"
  sidebar-selected: "#35584f"
  sidebar-selected-ink: "#b8eddf"
typography:
  headline:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', ui-sans-serif, system-ui, -apple-system, Roboto, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.025em"
  headline-mobile:
    fontSize: "1.5rem"
  title:
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.01em"
  subheading:
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "0"
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', ui-sans-serif, system-ui, -apple-system, Roboto, Arial, sans-serif"
    fontSize: ".9375rem"
    lineHeight: 1.5
  control:
    fontSize: ".875rem"
    fontWeight: 600
    lineHeight: 1.2
  field-mobile:
    fontSize: "1rem"
  secondary:
    fontSize: ".8125rem"
  label:
    fontSize: ".75rem"
  metric:
    fontSize: "1.5rem"
    fontWeight: 650
    letterSpacing: "-.02em"
rounded:
  status: "4px"
  navigation: "5px"
  control: "6px"
  surface: "8px"
  login: "12px"
spacing:
  inline-tight: "4px"
  inline: "8px"
  group: "12px"
  surface: "16px"
  section: "20px"
  context: "24px"
  desktop-gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.panel}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-2}"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.action}"
    rounded: "{rounded.control}"
  text-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
  status-chip:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.status}"
    padding: "3px 7px"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.surface}"
    padding: "16px"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  navigation-item-selected:
    backgroundColor: "{colors.sidebar-selected}"
    textColor: "{colors.sidebar-selected-ink}"
---

# Design System: Neat for Echo Spirits

## Overview

**Creative North Star: "Echo Operate"**

Neat is a precise, approachable field and comparison workspace. Echo's Copper, Patina and Chalkboard identity appears through selective accents, readable sans-serif type, compact records and fine organizing rules. Working information leads; the visual treatment helps a representative recognize an account and act, or a manager compare records.

This document records the implemented 0.7.0 development interface, extracted from the shared styles and representative components. It is not evidence of production delivery or human acceptance. The [UI/UX Guidelines](docs/UI-UX-GUIDELINES.md) govern future design decisions; shared presentation may be improved centrally under an authorized task. This record does not freeze the incumbent appearance. [PRODUCT.md](PRODUCT.md) supplies product truth and the [0.7.0 plan](docs/releases/0.7.0-plan.md) supplies this implementation's scope.

**Key Characteristics:**

- Compact hierarchy with useful records near the top of the working view.
- Neutral content surfaces, Copper actions and derived Patina selection/focus.
- Aligned comparison values, readable statuses and local qualifiers.
- Flat working surfaces with elevation reserved for floating interfaces.
- Mobile field actions and desktop comparison share one visual language.

## Colors

The frontmatter captures the implemented semantic palette, including accessible derivatives of Echo's source swatches. It is a reused subset of the runtime vocabulary, not a replacement stylesheet.

### Primary

- **Copper action** (`action`, `action-hover`): primary buttons and deliberate action emphasis. In light mode links use the same Copper values through runtime accent aliases. Dark mode retains Copper button fill and uses the lighter `dark-accent` pair for links and chart emphasis.

### Secondary

- **Derived Patina** (`accent-2`, `accent-soft`): focus and selected context. Dark mode uses `dark-accent-2` and `dark-accent-soft`. The brighter original brand swatch is not used as small white-text button fill.

### Neutral

- **Chalkboard ink** (`text`): principal light-theme text and the persistent desktop sidebar's structural surface.
- **Quiet canvas** (`bg`, `bg-2`): page background and secondary canvas tone.
- **Working surfaces** (`panel`, `panel-2`, `panel-3`): content, secondary grouping and stronger tonal separation.
- **Secondary ink** (`muted`, `muted-2`): context and supporting labels; `line` and `line-strong` separate rows and define controls.
- **Dark counterparts** (`dark-*`): explicit semantic replacements selected by the saved appearance preference, never image inversion. The desktop sidebar retains its own neutral ink, raised surface and selected treatment in either theme.

Semantic success, warning, danger, information, teal and purple surfaces pair with their corresponding ink. The runtime additionally defines border and fill variants in `app/styles.css` and `app/theme.css`; use those paired families for operational state rather than substituting a brand accent.

**The Meaning Before Brand Rule.** Status color carries a visible label or recognizable symbol. Copper does not imply warning, and Patina does not automatically imply success.

## Typography

**Body and heading font:** the available Segoe UI Variable Text stack in the frontmatter. Headings use the same family; there is no separate display typeface or web-font dependency. Interstate is a brand reference, not an installed or licensed web asset.

The type is a working hierarchy: moderate size changes, careful weight and sentence-case content. Numeric comparison values use tabular numerals and align right. Short navigation group labels retain small-cap treatment; this is not a license to add decorative eyebrows or kickers.

### Hierarchy

- **Headline:** page identity; the mobile override reduces the headline while preserving its weight and tracking.
- **Title / subheading:** section and local group hierarchy, respectively.
- **Body:** default reading text; dense tables use the control-sized text tier with larger record identity where helpful.
- **Control / field-mobile:** button labels and form text; mobile fields use the larger tier to remain legible and avoid browser input zoom.
- **Secondary / label:** metadata, concise qualifiers and table headers. They do not replace the size of decisive working facts.
- **Metric:** selective summary emphasis with tabular numerals. Inline metric strips also use a smaller observed (1.25rem) tier.

**The Comparable Numbers Rule.** Align comparable quantities right and use tabular numerals; keep their units, period and precision clear beside the result set.

## Layout

Use the available workspace width for tables and related facts. At the shared desktop breakpoint, the sidebar is (224px) wide and the main workspace uses (24px 32px 48px) padding without a global maximum width. The compact top bar gives global search up to (440px). Page headers place identity, count, local scope and actions together; toolbars wrap rather than forcing page overflow.

The spacing entries describe the reused rhythm rather than CSS custom properties: compact inline groups, modest surface padding and clear section boundaries. Shared cards use the surface step on desktop and an observed (14px) mobile padding. Explanatory page copy is constrained to (70ch), and empty-state copy to (65ch); comparison data is not constrained to a prose measure.

At (900px) and below, the sidebar yields to fixed mobile navigation, main padding becomes (16px) with bottom safe-area clearance, fields are at least (44px) high, and frequent buttons/disclosure controls receive the same target floor. General responsive record tables reflow into compact two-column record rows. Forecast comparison has its own (767px) reflow and a single-column treatment at (360px) for narrow/enlarged views. These are task-specific responsive choices, not a rule to turn every table cell into a separate card.

Two-dimensional evidence tables use contained horizontal overflow. The page itself must reflow without lateral scrolling. Preserve useful identity, decisive values, scope, status and reachable action in each mobile record.

**The Working Facts Rule.** Keep saved decision-driving facts and material exceptions visible; put supporting methods, longer history and infrequent editing behind a specifically named disclosure.

## Elevation & Depth

Working surfaces are flat: shared cards, tables, buttons and disclosure sections remove legacy shadows. Tonal backgrounds, row rules and borders establish structure. Mobile tabs also use a flat surface with a top divider. Floating overflow menus, action sheets and notices retain elevation where they overlap the workspace. Do not infer a universal no-shadow rule from flat data areas.

The sidecar records the current reusable overlay shadow and short state-transition vocabulary. Hover does not lift the shared button or record row. The existing reduced-motion media query disables animation and transitions and restores automatic scrolling.

**The Flat Working Surface Rule.** Use tone and fine rules for persistent working areas; reserve elevation for interfaces that actually float.

## Shapes

Small rectangular forms carry the system. Status chips have restrained corners, controls are gently rounded, and work surfaces use modest curvature; the frontmatter records their actual radius tiers. Navigation has its own compact tier. The sign-in panel retains the larger login tier. Repeated rows and supporting disclosure sections use square edges and fine dividers rather than individual rounded boxes.

## Components

### Buttons

Direct and stable. Primary buttons use Copper with white text; secondary buttons use a content surface, strong border and ordinary ink. Hover changes fill/border without moving the control. Link buttons remain transparent with accent text. Controls have a desktop minimum height of (40px), except the compact desktop search bar at (36px); mobile frequent actions use (44px). Disabled controls keep readable muted text and a distinct neutral surface. Focus uses the derived Patina outline (2px) with (3px) offset.

### Chips

Compact labels, not miniature primary buttons. Neutral chips use the secondary panel and muted ink; operational variants use paired semantic surface/ink and, where defined, border tokens. Selection and status must be named in text. An actionable chip still needs the appropriate touch target and interactive semantics.

### Cards / Containers

Use a bordered content surface for a distinct working area. Shared padding and radius come from the frontmatter; no shared card shadow. Do not put every saved fact or disclosure in its own box. Account saved summaries and supporting sections also use transparent, divider-led containers.

### Inputs / Fields

White or dark semantic content surface, strong border, readable placeholder, visible label and shared focus outline. Retain entered values and specific errors. Reuse the searchable record picker for record selection: search the supplied set, show match feedback, close and reset the query after selection, and return focus to the trigger. Preserve its disabled, error and Escape behavior when changing presentation.

### Navigation

The desktop sidebar is Chalkboard with light ink, compact icon-and-text links, grouped destinations and a clear selected row. Primary Log Visit remains distinct. Mobile uses compact fixed tabs and a secondary menu, with selected tone and safe-area padding. Navigation visibility follows existing role/feature scope; styling does not confer access.

### Comparison tables and read summaries

Record identity leads, shared column headers support scanning, and numbers align by meaning. Row hover uses a quiet secondary surface. Saved summaries use aligned term/value groups and inline metric strips rather than edit controls. Scope, sorting, freshness and material exceptions remain beside their results. Forecast uses one responsive product comparison representation with horizon controls; its source and model detail remain secondary.

### Supporting disclosures and states

Disclosure summaries are compact text rows with a simple CSS chevron and top divider. They expose secondary depth without hiding the main operational facts. Empty states use a concise title, explanation and relevant action. Calendar sync failures use a visible semantic danger block close to the task action; ordinary calendar status remains readable supporting text.

## Do's and Don'ts

### Do:

- **Do** use the shared semantic theme and component patterns across routes, checking both supported themes.
- **Do** keep identity, decisive comparisons, active scope and material exceptions visible in the working view.
- **Do** preserve readable mobile facts, 44px frequent touch targets, keyboard focus and contained table overflow.
- **Do** preserve known record/owner/return context, canonical workflow behavior and server-enforced organization/role scope.
- **Do** distinguish source review, fixture checks, hosted observations and human acceptance in delivery evidence.

### Don't:

- **Don't** introduce a competing page theme, decorative raster assets, display typography or packaging ornament into daily work.
- **Don't** add decorative kickers, oversized introductory banners, repeated field cards or motion that delays a working action.
- **Don't** use color alone for status, shrink decisive facts into captions or force page-level horizontal scrolling.
- **Don't** restore retired features or treat a presentation change as authorization to alter persistence, providers or production.
- **Don't** freeze this implementation as an immutable design requirement; follow the canonical UI/UX Guidelines when a future authorized task improves the shared system.

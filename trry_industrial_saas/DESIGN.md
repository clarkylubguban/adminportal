---
name: TRRY Industrial SaaS
colors:
  surface: '#fbf9f8'
  surface-dim: '#dbdad9'
  surface-bright: '#fbf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f3'
  surface-container: '#efeded'
  surface-container-high: '#e9e8e7'
  surface-container-highest: '#e4e2e2'
  on-surface: '#1b1c1c'
  on-surface-variant: '#5a4136'
  inverse-surface: '#303031'
  inverse-on-surface: '#f2f0f0'
  outline: '#8e7164'
  outline-variant: '#e2bfb0'
  surface-tint: '#a04100'
  primary: '#a04100'
  on-primary: '#ffffff'
  primary-container: '#ff6b00'
  on-primary-container: '#572000'
  inverse-primary: '#ffb693'
  secondary: '#5f5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2dfde'
  on-secondary-container: '#636262'
  tertiary: '#5d5f5f'
  on-tertiary: '#ffffff'
  tertiary-container: '#989999'
  on-tertiary-container: '#2f3132'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcc'
  primary-fixed-dim: '#ffb693'
  on-primary-fixed: '#351000'
  on-primary-fixed-variant: '#7a3000'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#fbf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e4e2e2'
typography:
  display:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-bold:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 11px
    fontWeight: '500'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-max: 1440px
  sidebar-width: 240px
  gutter: 24px
  margin-page: 32px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style

The design system is engineered for **Industrial Efficiency**. It bridges the gap between high-end apparel aesthetics and heavy-duty logistics management. The target audience consists of production managers and operations directors who require high data density without cognitive fatigue.

The visual style is **Corporate Modern with a "Tooling" edge**. It utilizes a monochromatic foundation to establish authority, while employing a high-visibility orange accent to guide action. The layout is desktop-first, prioritizing horizontal space for complex data tables and multi-pane inspections. Surfaces are clean and layered, using soft shadows and subtle borders to define clear work zones.

## Colors

The palette is strictly functional. 
- **Primary (Safety Orange):** Reserved exclusively for primary actions, critical status updates, and interactive highlights. It represents energy and urgency.
- **Neutral Core:** A range of grays from `#1A1A1A` (Deep Carbon) for typography to `#F9F9F9` (Off-white) for background surfaces. This ensures the interface feels like a professional piece of equipment.
- **Semantic Accents:** Status colors (Green, Blue, Orange, Yellow) use a "soft pill" background with a high-contrast text color to ensure readability within dense tables.

## Typography

**Hanken Grotesk** is the sole typeface, chosen for its geometric precision and excellent legibility at small sizes. 
- **Hierarchy:** Use bold weights for headers to anchor the page. 
- **Data Labels:** Use the `label-bold` style (uppercase with tracking) for table headers and metadata labels to differentiate them from user-generated content.
- **Body Text:** Standardize on 14px for most dashboard content to maximize information density while maintaining a professional "SaaS" feel.

## Layout & Spacing

This design system uses a **Fixed-Fluid Hybrid** layout. 
- **Sidebar:** A fixed 240px vertical navigation on the left provides constant access to core modules.
- **Main Canvas:** A fluid area that accommodates a 12-column grid. 
- **Detail Panels:** Contextual "Right Drawers" or side-panels occupy 30% of the screen width when viewing specific order or client details, pushing the main table to the left.
- **Rhythm:** An 8px base unit controls all padding and margins. Cards use 24px internal padding for a spacious, breathable feel amidst complex data.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Subtle Elevation**:
- **Level 0 (Background):** Light gray (`#F4F4F4`) acts as the canvas.
- **Level 1 (Cards/Surface):** White (`#FFFFFF`) with a 1px border (`#E5E5E5`) or a very soft, large-radius shadow (e.g., `0px 4px 20px rgba(0,0,0,0.04)`).
- **Level 2 (Modals/Popovers):** White with a more pronounced shadow to indicate temporary overlay.
- **Interactions:** Hover states on rows or cards should use a subtle gray tint (`#F9F9F9`) or a primary-colored left-border accent to indicate focus.

## Shapes

The shape language is **Refined-Industrial**. 
- **Standard Radius:** 8px (`rounded-md`) is used for cards, input fields, and main buttons to soften the "enterprise" feel.
- **Large Radius:** 16px (`rounded-lg`) is used for distinct container sections or dashboard widgets.
- **Status Pills:** Fully rounded (pill-shaped) for badges to make them instantly recognizable as non-interactive status indicators.

## Components

### Buttons
- **Primary:** Solid orange background, white text. No gradient.
- **Secondary:** White background, 1px gray border, black text.
- **Tertiary/Ghost:** Text only, turns light orange on hover.

### Tables
- **Header:** Uppercase, tracking +5%, light gray text.
- **Rows:** Minimum height of 56px. Hover state background `#F9F9F9`.
- **Status Badges:** Text-color is a darker version of the background tint (e.g., Dark Green text on Light Green background).

### Input Fields
- **Default:** White background, 1px light gray border. Focus state uses a 1px orange border and a subtle orange glow.
- **Search:** Always includes a magnifying glass icon and "Cmd+K" style placeholder hint.

### Cards & Stats
- **Stat Cards:** Feature a prominent icon in a circular light-tinted background, followed by a bold numerical value and a "delta" (trend) indicator.
- **Action Cards:** Bottom-aligned primary buttons or "Quick Action" list items with right-pointing chevrons.
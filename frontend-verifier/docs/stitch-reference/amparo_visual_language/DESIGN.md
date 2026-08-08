---
name: Amparo Visual Language
colors:
  surface: '#fcf8fe'
  surface-dim: '#dcd9df'
  surface-bright: '#fcf8fe'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f2f8'
  surface-container: '#f1ecf2'
  surface-container-high: '#ebe7ed'
  surface-container-highest: '#e5e1e7'
  on-surface: '#1c1b1f'
  on-surface-variant: '#47464f'
  inverse-surface: '#313034'
  inverse-on-surface: '#f3eff5'
  outline: '#787681'
  outline-variant: '#c8c5d1'
  surface-tint: '#5b5795'
  primary: '#110847'
  on-primary: '#ffffff'
  primary-container: '#26215c'
  on-primary-container: '#8e8acb'
  inverse-primary: '#c5c0ff'
  secondary: '#5c5890'
  on-secondary: '#ffffff'
  secondary-container: '#c5c0ff'
  on-secondary-container: '#504c83'
  tertiary: '#1a1509'
  on-tertiary: '#ffffff'
  tertiary-container: '#2f291c'
  on-tertiary-container: '#99907e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3dfff'
  primary-fixed-dim: '#c5c0ff'
  on-primary-fixed: '#17114d'
  on-primary-fixed-variant: '#443f7b'
  secondary-fixed: '#e3dfff'
  secondary-fixed-dim: '#c5c0ff'
  on-secondary-fixed: '#181348'
  on-secondary-fixed-variant: '#444076'
  tertiary-fixed: '#ede1cd'
  tertiary-fixed-dim: '#d0c5b2'
  on-tertiary-fixed: '#201b0f'
  on-tertiary-fixed-variant: '#4d4638'
  background: '#fcf8fe'
  on-background: '#1c1b1f'
  surface-variant: '#e5e1e7'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  xxl: 80px
---

## Brand & Style
The design system is built on the concept of **Atmospheric Etherealism**—a synthesis of high-precision data security and soft, human-centric elegance. It avoids the cold, bureaucratic aesthetics of traditional verification portals in favor of a workspace that feels protective and calm.

The visual narrative centers on clarity and the "reveal." By utilizing semi-transparent surfaces and soft gradients, the UI suggests a layered approach to privacy. The aesthetic is professional yet approachable, signaling a "privacy-first" philosophy through generous whitespace and a sophisticated, light-filled environment.

## Colors
The palette is anchored by **Deep Midnight (#26215C)**, representing institutional trust and authority. This is balanced by a high-key environment of **Mist Backgrounds (#F8F6FC)** and **Ice (#E6F2FA)**.

- **Primary:** Used for essential navigation, primary actions, and high-level headers.
- **Warmth (Cream):** Reserved exclusively for banners containing human-centric content or sensitive assistance information to provide a reassuring contrast to the technical verification flow.
- **Accents (Lavender/Pink):** Utilized for interactive states and the "Verification Orb" to create a modern, ethereal glow.
- **Status:** Verified states use high-contrast primary text against Ice or Lavender backgrounds to ensure immediate legibility.

## Typography
The system employs a dual-typeface strategy to bridge the gap between contemporary character and utilitarian precision.

**Manrope** is used for all headlines and display text. Its geometric yet slightly soft apertures provide a sophisticated, modern feel. **Inter** is used for all body copy, data points, and interface labels due to its exceptional legibility at small sizes and neutral, systematic tone.

Text hierarchy is strictly maintained to guide the eye through verification steps. Use "Condición verificada" for status indicators, avoiding all-caps except for very small labels.

## Layout & Spacing
The layout follows a **Desktop-First** philosophy, targeting a 1440px viewport with a centered 1240px content container. 

- **Grid:** A 12-column grid with 24px gutters is the standard for content blocks.
- **Header:** A fixed horizontal header (80px height) should be light and semi-transparent, allowing background gradients to bleed through slightly. No sidebars are used to keep the focus central and linear.
- **Mobile Reflow:** On mobile devices, the 1240px container becomes fluid with 20px side margins. Cards stack vertically, and the "Verification Orb" reduces in size by 20%.

## Elevation & Depth
Depth is created through **Atmospheric Layering** rather than traditional heavy shadows.

- **Glassmorphism:** All primary containers use a backdrop blur of 18px with a white semi-transparent fill (alpha 60-80%). 
- **Borders:** Surfaces are defined by "Ghost Borders"—1px solid lines using #FFFFFF at 40% opacity or Light Lavender.
- **Shadows:** Use only "Ambient Glow" shadows: `0 20px 40px rgba(38, 33, 92, 0.04)`.
- **The Orb:** The "Verification Orb" (72-88px) sits at the highest elevation, utilizing a radial gradient (Lavender to Ice) and a soft outer glow to appear as if it is floating above the interface.

## Shapes
The shape language is organic and approachable, utilizing a tiered rounding system:

- **8px (Small):** Interactive inputs, small buttons, and tags.
- **16px (Medium):** Standard content cards and notification toasts.
- **24px/32px (Large):** Primary modal containers and hero banners.
- **999px (Pill):** Used for the "Verification Orb" and status badges to signify a finished, "held" object.

## Components

### Verification Orb
A signature element. A 72-88px circle with a subtle pulse animation when processing. It uses a gradient from Lavender (#C5C0FF) to Ice (#E6F2FA). It serves as the primary visual indicator of system "activity."

### Glass Cards
Primary content containers.
- **Background:** White @ 70% opacity.
- **Blur:** 18px.
- **Border:** 1px solid #FFFFFF (50% opacity).
- **Corner Radius:** 24px.

### Buttons
- **Primary:** Deep Midnight (#26215C) with white text, 8px radius.
- **Secondary:** Light Lavender background with Lavender text.
- **Ghost:** No background, 1px Ice border.

### Input Fields
Minimalist design. Underline-only or very soft tinted backgrounds (#F1F1F1). Focus state uses a soft Lavender glow rather than a harsh border change.

### Data Privacy States
- **Verified Data:** Displayed in Deep Midnight on an Ice background.
- **Private Data:** Represented by a blurred "placeholder" effect or a subtle geometric pattern, ensuring the user knows data exists but is currently shielded.

### Banners
Human-centric help or support banners must use the **Cream (#FAEEDA)** background to differentiate from the technical verification flow.
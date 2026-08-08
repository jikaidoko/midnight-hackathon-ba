---
name: Atmospheric Ethereal
colors:
  surface: '#fcf8ff'
  surface-dim: '#dad7f7'
  surface-bright: '#fcf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f2ff'
  surface-container: '#efebff'
  surface-container-high: '#e9e5ff'
  surface-container-highest: '#e3dfff'
  on-surface: '#1a1931'
  on-surface-variant: '#47464f'
  inverse-surface: '#2f2e47'
  inverse-on-surface: '#f3eeff'
  outline: '#787681'
  outline-variant: '#c8c5d1'
  surface-tint: '#5b5795'
  primary: '#110847'
  on-primary: '#ffffff'
  primary-container: '#26215c'
  on-primary-container: '#8e8acb'
  inverse-primary: '#c5c0ff'
  secondary: '#605b73'
  on-secondary: '#ffffff'
  secondary-container: '#e3dcf9'
  on-secondary-container: '#646078'
  tertiary: '#1c121b'
  on-tertiary: '#ffffff'
  tertiary-container: '#322630'
  on-tertiary-container: '#9d8c99'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3dfff'
  primary-fixed-dim: '#c5c0ff'
  on-primary-fixed: '#17114d'
  on-primary-fixed-variant: '#443f7b'
  secondary-fixed: '#e6dffb'
  secondary-fixed-dim: '#c9c3df'
  on-secondary-fixed: '#1c192d'
  on-secondary-fixed-variant: '#48445b'
  tertiary-fixed: '#f1ddeb'
  tertiary-fixed-dim: '#d4c1cf'
  on-tertiary-fixed: '#231822'
  on-tertiary-fixed-variant: '#50434e'
  background: '#fcf8ff'
  on-background: '#1a1931'
  surface-variant: '#e3dfff'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  unit: 8px
  container-padding-mobile: 24px
  container-padding-desktop: 64px
  gutter: 16px
  element-gap: 20px
  section-gap: 48px
---

## Brand & Style

The design system is defined by an **Atmospheric Ethereal** aesthetic, shifting away from rigid institutional structures toward a humanized, fluid, and premium digital experience. It evokes feelings of privacy, protection, and effortless intelligence, making it ideal for a personal voice assistant.

The visual language combines **Glassmorphism** with a soft, tactile palette. It relies on multi-layered depth, using diffused radial gradients and translucent glass surfaces to create a sense of light and space. Elements feel "buoyant," as if floating in a weightless environment rather than fixed to a static grid. 

High-contrast primary accents are used sparingly to maintain an aura of calm, ensuring that key actions feel intentional and authoritative within a soft, pastel-driven landscape.

## Colors

The palette is anchored by an atmospheric background (#F8F6FC) that serves as a canvas for soft radial glows. 

- **Primary Contrast:** #26215C is reserved strictly for high-priority CTAs, ensuring visual weight is concentrated on single, meaningful actions.
- **Surface Tiers:** Use warm pastel tokens (`pastel_cream`, `pastel_peach`, `secondary`, `tertiary`) to differentiate content categories without adding visual noise.
- **Atmospheric Gradients:** Implement large, low-opacity radial blurs in the background using the secondary, tertiary, and blue-ice tokens to create organic depth.
- **Glass Effects:** Navigation bars and hero overlays use a translucent white with an 18px backdrop blur to maintain legibility while preserving the background's airy quality.

## Typography

This design system utilizes a dual-font strategy to balance character with readability.

- **Manrope** is used for all headlines and display text. Its geometric yet friendly curves reinforce the "modern human" persona. Use heavy weights (700-800) for large titles to create a strong visual anchor against the soft background.
- **Inter** is the workhorse for body copy, labels, and metadata. It provides a clean, neutral balance to the expressive headlines.
- **Hierarchy:** Maintain generous vertical rhythm. Titles should never feel crowded; let them "breathe" with ample line height.

## Layout & Spacing

The layout philosophy is **Airy & Fluid**. It rejects dense, data-heavy grids in favor of an expansive composition with significant negative space.

- **Floating Hierarchy:** Elements are often detached from screen edges, using safe margins of 24px or more to create a "floating" effect.
- **Rhythm:** Use an 8px base unit. Section gaps should be aggressive (48px+) to prevent the interface from feeling cluttered or bureaucratic.
- **Responsibility:** On mobile, use a single-column layout with center-aligned hero elements. On desktop, transition to a fluid layout where pastel cards are clustered into organic groups rather than a rigid 12-column masonry.

## Elevation & Depth

Depth is conveyed through **Glassmorphism** and **Extreme Soft Shadows**.

1.  **Level 0 (Background):** The base layer with soft radial color gradients.
2.  **Level 1 (Cards):** Low-contrast pastel surfaces. These do not use heavy shadows but rather a very faint, large-radius tint (`0 16px 44px rgba(38,33,92,0.08)`).
3.  **Level 2 (Glass Hero):** Surfaces using `rgba(255, 255, 255, 0.68)` with an 18px blur. These should appear to sit higher than the background but below the primary interaction points.
4.  **Level 3 (Primary CTAs):** Solid blocks of #26215C that break the "softness" to demand immediate attention.

## Shapes

The shape language is dominated by **large, friendly radii**. 

- **Cards:** Use a consistent 32px radius (`rounded-xl`) to emphasize the soft, approachable nature of the brand.
- **Interactive Elements:** Buttons, chips, and input fields should be pill-shaped (999px) where possible.
- **Visual Continuity:** Avoid sharp corners entirely. Even inner elements like icons or progress bars should have rounded caps and corners to match the parent container's softness.

## Components

### Buttons
- **Primary:** Pill-shaped, #26215C background with white Manrope text. Only one per view.
- **Secondary:** Glassmorphic background with 1px semi-transparent white border.
- **Ghost:** Text-only with a subtle lavender hover state.

### Cards
- **Pastel Containers:** Use the defined pastel tokens. Borders should be avoided; depth is created via the extremely soft shadow token.
- **Hero Cards:** Utilize the Glassmorphism style (68% opacity white) to let background gradients peek through.

### Inputs & Fields
- **Search/Voice Input:** Large, pill-shaped glass containers. Icons should be thin-stroke (1.5px) and colored in the primary #26215C or a deep lavender.

### Voice Visualizer
- A signature component for this design system. It should use a fluid, organic blob or wave animation that mirrors the background radial colors, appearing as a 3D glass sphere or an iridescent waveform.

### Floating Navigation
- Instead of a docked bottom bar, use a floating glass pill centered at the bottom of the screen with a heavy backdrop blur.
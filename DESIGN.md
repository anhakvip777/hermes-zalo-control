---
name: Hermes Zalo Admin
description: Operations dashboard for controlled AI messaging via Zalo. Calm, reliable, Vietnamese operator friendly.
colors:
  primary: "#2563EB"
  primaryDark: "#1D4ED8"
  primaryLight: "#DBEAFE"
  success: "#16A34A"
  successLight: "#DCFCE7"
  warning: "#D97706"
  warningLight: "#FEF3C7"
  danger: "#DC2626"
  dangerLight: "#FEE2E2"
  info: "#0891B2"
  infoLight: "#CFFAFE"
  background: "#F8FAFC"
  surface: "#FFFFFF"
  surfaceMuted: "#F1F5F9"
  border: "#E2E8F0"
  text: "#0F172A"
  textMuted: "#64748B"
  textLight: "#94A3B8"
typography:
  h1:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
  h2:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
  h3:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
  bodySmall:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  "2xl": "48px"
shadow:
  card: "0 1px 2px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.08)"
  cardHover: "0 4px 6px rgba(15,23,42,0.06), 0 2px 4px rgba(15,23,42,0.08)"
---

# Hermes Zalo Admin — Design System

## Overview

Hermes Zalo Admin is an operations dashboard for controlled AI messaging through Zalo. Operators manage allowed threads, review message status, monitor system health, and run controlled live tests.

The UI should feel **calm, reliable, and easy to scan** — not playful or overloaded.

## Principles

1. **Safety first**: dryRun status, live test state, and session warnings must be immediately visible.
2. **Status clarity**: every message/action shows clear state via color-coded badges.
3. **Vietnamese operator friendly**: concise labels, compact tables, no unnecessary jargon.
4. **No visual clutter**: cards, badges, clean tables, consistent spacing.
5. **Dangerous actions**: strong contrast and confirmation required (e.g., live test start).

## Colors

### Primary — Trust & Action
- `primary` (#2563EB): Main actions, links, selected states
- `primaryDark` (#1D4ED8): Hover/pressed states
- `primaryLight` (#DBEAFE): Subtle backgrounds, info banners

### Status Colors
- `success` (#16A34A) / `successLight` (#DCFCE7): Connected, SENT, active, PASS
- `warning` (#D97706) / `warningLight` (#FEF3C7): DRY RUN, COOLDOWN, session warning
- `danger` (#DC2626) / `dangerLight` (#FEE2E2): FAILED, BLOCKED, disconnected, PERM DENIED
- `info` (#0891B2) / `infoLight` (#CFFAFE): Informational, neutral state

### Neutral
- `background` (#F8FAFC): Page background
- `surface` (#FFFFFF): Cards, table headers
- `surfaceMuted` (#F1F5F9): Secondary rows, disabled states
- `border` (#E2E8F0): Dividers, card borders
- `text` (#0F172A): Primary text
- `textMuted` (#64748B): Secondary text, labels
- `textLight` (#94A3B8): Placeholder, disabled text

## Typography

Use system font stack with Inter preferred. Monospace for IDs, tokens, code.

| Scale | Size | Weight | Use |
|-------|------|--------|-----|
| h1 | 1.875rem | 700 | Page titles |
| h2 | 1.25rem | 650 | Section headers, card titles |
| h3 | 1.0625rem | 600 | Sub-headers, table captions |
| body | 0.9375rem | 400 | Main content, table rows |
| bodySmall | 0.8125rem | 400 | Meta info, timestamps, captions |
| mono | 0.8125rem | 400 | IDs, URLs, tokens, code |

## Components

### Status Badge

Pill-shaped badge with color-coded background:
- **SENT** / **connected** / **active** → `success` bg + `success` text
- **DRY RUN** → `warning` bg + `warning` text
- **COOLDOWN** / **session warning** → `warning` bg + `warning` text
- **FAILED** / **BLOCKED** / **PERM DENIED** / **disconnected** → `danger` bg + `danger` text
- **PENDING** / **unknown** → `surfaceMuted` bg + `textMuted` text

Size: `bodySmall` font, 4px 10px padding, `rounded sm`.

### Card

White `surface` background, `border` outline, `rounded lg`, `shadow card`. Use for summary stats, info sections.

### Table

- Header: `surfaceMuted` background, `bodySmall` uppercase text
- Row: white background, hover `surfaceMuted`
- Zebra optional for large tables
- Monospace for thread IDs, tokens
- Status badge in cell for role/status columns

### Page Layout

- Consistent `max-width: 7xl` centered container
- Padding: `lg` (24px) horizontal, `xl` (32px) vertical
- Page title: `h1` at top, optional description in `textMuted`
- Breadcrumbs or back link in `bodySmall textMuted`

### Sidebar Navigation

Grouped sections with compact labels:
- **Operations**: Messages, Schedules
- **Access**: Access Control, Thread Settings
- **Safety**: Production Readiness, System Health, Safety Mode
- **System**: Zalo Ops, Runtime Settings, Errors, Admin Tools, Documents

Active item: `primaryLight` background, `primary` text, left border accent.
Inactive: `textMuted`, hover `surfaceMuted`.

### Time Display

Primary: Vietnam time `DD/MM/YYYY HH:mm:ss` (UTC+7 / Asia/Ho_Chi_Minh).
Secondary: UTC ISO timestamp for technical reference.
Label UTC explicitly when shown alongside VN time.

## Live Test Banner

When a controlled live test is active, show a prominent banner at top:
- `warning` background, `warning` text
- Show: thread ID, sentCount/maxMessages, remaining time
- Stop button with `danger` styling

## Safety Banners

Always visible in header or top area:
- **DRY RUN ACTIVE**: `infoLight` background, shows global dryRun state
- **SESSION WARNING**: `warningLight` background if session file missing
- **LIVE TEST ACTIVE**: `dangerLight` background if live test running

## Responsive

- Desktop-first: optimize for 1440px+
- Collapse sidebar on mobile (< 768px)
- Tables scroll horizontally on narrow screens

## File Organization

```
packages/frontend/src/
  app/                    # Next.js App Router pages
    layout.tsx            # Root layout with sidebar
    messages/             # /messages
    access-control/       # /access-control
    zalo-ops/             # /zalo-ops
    ...
  components/
    ui/                   # Shared UI components
      StatusBadge.tsx
      PageHeader.tsx
      Card.tsx
      TimeText.tsx
```

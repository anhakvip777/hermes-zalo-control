---
name: Hermes Zalo Bridge
description: Admin dashboard bridging Zalo ⇄ Hermes Agent. Developer-first dark technical UI — clean, scannable, status-driven.
colors:
  brand: "#3B82F6"
  brandDark: "#2563EB"
  brandBg: "#1E3A5F"
  success: "#22C55E"
  successBg: "#052E16"
  warning: "#F59E0B"
  warningBg: "#1C1200"
  danger: "#EF4444"
  dangerBg: "#1C0000"
  info: "#22D3EE"
  infoBg: "#082F49"
  background: "#0B1222"
  surface: "#1E293B"
  surfaceRaised: "#263348"
  border: "#334155"
  borderSubtle: "#1E293B"
  text: "#E2E8F0"
  textMuted: "#94A3B8"
  textSubtle: "#64748B"
typography:
  fontFamily: "Inter, system-ui, -apple-system, sans-serif"
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace"
  h1: { size: "1.25rem", weight: 700 }
  h2: { size: "1.0625rem", weight: 600 }
  body: { size: "0.875rem", weight: 400 }
  small: { size: "0.8125rem", weight: 400 }
  micro: { size: "0.6875rem", weight: 500 }
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
shadow:
  card: "0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)"
  raised: "0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)"
---

# Hermes Zalo Bridge — Design System

## Overview

Hermes Zalo Bridge is a developer-facing operations dashboard. It bridges Zalo messaging ⇄ Hermes AI Agent. The UI must make **system state immediately legible**: Zalo connected/disconnected, dryRun on/off, live active/inactive, messages sent/blocked.

**NOT:** a consumer product. NOT a marketing site. NOT dark cyberpunk.
**YES:** Clean technical admin. Linear/Vercel dark mode aesthetic. Vietnamese-friendly.

## Design Principles

1. **State first**: dryRun, live, Zalo status visible in every view — top bar always present.
2. **Color signals, not decoration**: Green = safe/connected. Yellow = dry-run/warning. Red = error/live. Blue = info/action.
3. **Compact data**: Use small mono text for IDs/timestamps. Tables over cards for lists.
4. **Empty states always informative**: Never a blank page. Show context + next action.
5. **Confirmations for danger**: Live test start, disconnect — always confirm first.

## Color System

### Dark Surface Palette
- `bg` `#0B1222` — page background (darkest)
- `surface` `#1E293B` — cards, sidebar body
- `surface-raised` `#263348` — elevated areas, hover
- `border` `#334155` — card/table borders
- `border-subtle` `#1E293B` — subtle dividers

### Text
- `text` `#E2E8F0` — primary content
- `text-muted` `#94A3B8` — labels, secondary info
- `text-subtle` `#64748B` — placeholders, tertiary

### Status
- **Success** `#22C55E` on `#052E16` bg — SENT, connected, PASS
- **Warning** `#F59E0B` on `#1C1200` bg — DRY RUN, COOLDOWN, stale
- **Danger** `#EF4444` on `#1C0000` bg — FAILED, BLOCKED, disconnected, live active
- **Info** `#22D3EE` on `#082F49` bg — neutral info, SCHEDULED
- **Brand** `#3B82F6` on `#1E3A5F` bg — actions, links, active nav

## Components

### Cards
```
bg-slate-800 border border-slate-700 rounded-lg p-4 shadow-card
```
Header: `text-xs font-semibold text-slate-400 uppercase tracking-wider`

### Status Badges
Pill shape: `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border`
- SENT: `bg-green-950 text-green-400 border-green-800`
- DRY RUN: `bg-amber-950 text-amber-400 border-amber-800`
- FAILED: `bg-red-950 text-red-400 border-red-800`
- BLOCKED: `bg-red-950 text-red-400 border-red-800`
- SCHEDULED: `bg-cyan-950 text-cyan-400 border-cyan-800`
- COMPLETED: `bg-green-950 text-green-400 border-green-800`
- ACTIVE: `bg-green-950 text-green-400 border-green-800`
- PAUSED: `bg-yellow-950 text-yellow-400 border-yellow-800`
- CANCELLED: `bg-slate-800 text-slate-500 border-slate-700`

### Tables
- Container: `rounded-lg border border-slate-700 overflow-x-auto`
- thead: `bg-slate-900 border-b border-slate-700`
- th: `px-3 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-400 tracking-wider`
- tbody tr: `border-b border-slate-700/60 hover:bg-slate-700/30 transition-colors`
- td: `px-3 py-2.5 text-sm text-slate-300`

### Input / Select
`bg-slate-900 border border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-md px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none`

### Buttons
- Primary: `bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-medium`
- Secondary: `bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 px-3 py-1.5 rounded-md text-sm`
- Danger: `bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium`
- Ghost: `text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 px-3 py-1.5 rounded-md text-sm`

### Sidebar
- Container: `w-60 bg-slate-900 border-r border-slate-800 flex-shrink-0`
- Active: `bg-blue-500/10 text-blue-400 border-l-2 border-blue-500`
- Hover: `hover:bg-slate-800 text-slate-300 hover:text-slate-100`
- Group label: `text-[10px] font-semibold uppercase tracking-wider text-slate-600`

### Top Bar
Fixed top bar showing live system state:
- App name + icon
- dryRun badge (yellow if true, red if false)
- Live test badge (green off, red if active)
- Zalo status (green if connected)

### Empty States
```tsx
<div className="rounded-lg border border-slate-700 bg-slate-800/50 p-10 text-center">
  <p className="text-slate-500 text-sm">Không có dữ liệu</p>
  <p className="text-slate-600 text-xs mt-1">...</p>
</div>
```

### Error States
```tsx
<div className="rounded-lg border border-red-800/50 bg-red-950/30 p-6 text-center">
  <p className="text-red-400 text-sm">❌ {error}</p>
  <button>🔄 Thử lại</button>
</div>
```

### Loading Skeletons
`animate-pulse bg-slate-800 rounded-lg h-24`

## Scope / Readiness Display

Three-tier always visible:
- **Controlled DM**: ✅ READY (green)
- **Global Live**: ⏸ NOT READY (slate/gray — not red, not alarming)
- **Group Rollout**: ⏸ NOT READY (slate/gray)

"NOT READY for global live" is expected baseline — don't make it look like an error.

## Page Structure

```
<body bg-[#0B1222]>
  <div flex>
    <aside w-60 sidebar>
      logo + nav
    </aside>
    <main flex-1>
      <TopBar />           ← dryRun + Zalo status always visible
      <div p-6 content>
        {children}
      </div>
    </main>
  </div>
</body>
```

# DigitalBurj Logistics OS — Brand & Design System

> **One system. Every operation.** — The operating system for an international freight forwarder, customs broker and bonded-warehouse operator.

| Open | What it is |
|---|---|
| `brand/brand-guidelines.html` | Full brand & design-system guide (logo rules, colour, type, shape, components, sector environments, motion, icons) |
| `brand/brand-board.png` | Full-page image of the guide |
| `design/dashboard-v2.html` | **Current** Owner dashboard — soft bento + frosted glass, map hero, all 14 product areas (animated) |
| `design/dashboard-v2.png` | Full-page image of dashboard v2 |
| `design/dashboard.html` / `.png` | v1 (dark-sidebar, dense operations layout) |

## Brand kit
```
brand/
  assets/logo/   digitalburj-logistics-os-logo.png  ← master, byte-identical to the supplied logo
                 mark-only.png · icon-512/192/180/64/32.png · favicon.ico
  tokens/        tokens.css · tokens.json
  css/           components.css · guidelines.css
  js/            icons.js (40-icon set) · motion.js (reveal, count-up, pause-motion)
  fonts/         Chakra Petch · Barlow · Barlow Condensed · IBM Plex Mono (all OFL, self-hosted)
design/          dashboard.html · dashboard.css · dashboard.png
```

## Design in one paragraph
Container-green and signal-red come straight from the logo. Freight vocabulary does the rest: sea = blue, air = sky, road = hi-vis amber, warehouse = kraft, customs = stamp indigo. Type is signage-driven (Chakra Petch headings, Barlow UI, Barlow Condensed shipping-label caps/KPIs, IBM Plex Mono for BL/AWB/container/HS codes). Shapes carry a chamfered "container casting" corner; textures are corrugation, hazard stripe and barcode. Motion mirrors digitalburj.com — staged reveals, floating live cards, count-up KPIs, flowing lanes, global **Pause motion** — and respects `prefers-reduced-motion`.

## Rules worth remembering
* The logo is a **transparent PNG with near-black ink** — always place it, unmodified, on a pure-white plate.
* White text on brand Signal Red (#F5280A) is only 4.05:1. Filled buttons/badges use **Action Red #E12509 (4.7:1)**.
* Estimated ≠ actual: tracking events always show their source; inferred values are hatched.
* Status dimensions (execution · customs · documents · finance · e-invoice) are never collapsed into one.

All figures, names and entities in the dashboard are fictional sample data.

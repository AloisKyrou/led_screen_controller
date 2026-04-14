# LED Screen Controller

Node.js ArtNet server + browser VJ interface for a 60×15 WS2812B LED panel. 17 effects, live text pool, kick flash, per-effect color/rainbow/brightness — controlled from phone over local network.

---

## Hardware setup

```
Phone (hotspot) ──── Computer ──── Router ──── LED Panel
                    (Node.js)    (ArtNet UDP broadcast)
```

- **Panel**: 60×15 pixels, WS2812B (GRB byte order), serpentine wiring
- **Protocol**: ArtNet over UDP broadcast (`255.255.255.255:6454`)
- **Universes**: 6–11 (6 universes × 170 pixels = 900 px + spare)
- **Framerate**: 30 FPS

---

## Stack

| Layer | Tech |
|---|---|
| Server | Node.js + Express |
| Transport | ArtNet UDP (raw `dgram` socket, no library) |
| UI | Vanilla JS + plain HTML/CSS, served statically |
| Persistence | `effects.json` (effect configs), `text.json` (text pools) |

---

## Architecture

### `server.js`
Single-file server. Handles:
- Loading effect modules from `effects/` at startup
- ArtNet packetizing and broadcast
- Effect scheduler (weighted random, duration-based, respects `done` flag for scroll)
- Kick flash override (full-panel color burst)
- Global brightness scaling
- REST API for the browser UI

### `effects/`
Each file exports `{ name, init, frame }`:
- `init(W, H, config, shared) → state` — called once when the effect starts
- `frame(state, t, dt, config, shared) → Uint8Array(H×W×3)` — called at 30 FPS, returns RGB pixel buffer

`font.js` provides bitmap font rendering (`buildTape`, `buildAutoMask`), `hexToRgb`, `hsvToRgb`.

### `public/`
Static UI — single page, polls `/api/state` every 500ms. No framework.

---

## Effects

| Effect | Description |
|---|---|
| `nools` | Custom logo animation |
| `fete_trouble` | Party-mode strobing fills |
| `scroll_text` | Scrolling text from pool, waits for full pass before advancing |
| `static_text` | Centered text, 1 or 2 lines auto-fitted |
| `simple_firework` | Expanding burst particles |
| `fading_pixel` | Random pixels fade in/out |
| `bouncing_balls` | Physics balls with gravity and bounce |
| `pumping_circle` | Expanding/contracting circle pulse |
| `simple_snake` | Classic snake on the grid |
| `simple_color_scroll` | Rainbow columns scrolling left |
| `c64_loadscreen` | Commodore 64 loading screen aesthetic |
| `fillscreen_snakewise` | Screen fill following serpentine path |
| `moving_tile_puzzle` | Sliding tile puzzle animation |
| `fire` | Cellular automaton fire |
| `rain` | Falling rain drops with trails |
| `starfield` | Zoom-out starfield |
| `raindrops` | Ripple rings from random impact points |

---

## API

```
GET  /api/state                        → full server state + effect list
POST /api/effects/:id/config           → { freq, duration, brightness, enabled, color, rainbow, speed }
POST /api/effects/:id/play             → force-play an effect
POST /api/next                         → skip to next
POST /api/blackout                     → toggle blackout
POST /api/brightness                   → { value: 0..1 }
POST /api/text                         → { scrollPool: [{text, color, rainbow}], staticPool: [...] }
POST /api/event                        → { type:'kick', on:bool, color:'#rrggbb', brightness:0..1 }
```

---

## Config

**`effects.json`** — per-effect settings persisted across restarts:
```json
{
  "bouncing_balls": { "duration": 10, "freq": 5, "brightness": 1, "enabled": true, "rainbow": true, "color": "#00a3f5" }
}
```

**`text.json`** — scroll/static text pools:
```json
{
  "scrollPool": [{ "text": "NOOLS", "color": "#ffffff", "rainbow": false }],
  "staticPool":  [{ "text": "NOOLS", "color": "#ff8800", "rainbow": false }]
}
```

`EFFECT_DEFAULTS` in `server.js` provides fallback values so the server works correctly even if `effects.json` reverts (Google Drive sync issue).

---

## Running

```bash
npm install
node server.js
```

On startup the console prints all network IPs. Connect the phone browser to the hotspot IP:
```
http://192.168.x.x:3000
```

If the phone can't connect, allow the port through Windows Firewall:
```powershell
netsh advfirewall firewall add rule name="Panel Controller" dir=in action=allow protocol=TCP localport=3000
```
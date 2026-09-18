# LED Screen Controller

Node.js ArtNet server + browser VJ interface for a 60×15 WS2812B LED panel. Effects, live text, image/GIF upload, scene cues, kick flash, and per-effect controls — controlled from a phone over the local network.

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
| Persistence | `effects.json`, `text.json`, `scene.json`, `media.json`, `messages.json` |

---

## Architecture

### `server.js`
Single-file server. Handles:
- Loading effect modules from `effects/` at startup
- ArtNet packetizing and broadcast
- Effect scheduler (weighted random, duration-based, respects `done` flag for scroll)
- Multi-scene mode (ordered timed cues, manual next/previous, looping, then return to AUTO)
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
| `static_text` | Centered text with safe margins, compact wrapping and automatic pagination |
| `public_messages` | One approved public message from the FIFO queue, selected by the AUTO scheduler |
| `media` | Uploaded image or animated GIF, converted to 60×15 in the control browser |
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
POST /api/text/:type/:index/play       → play one exact scroll/static pool entry
GET  /api/public/messages/config       → public submission mode and limits
GET  /api/public/messages/:id/status   → private receipt-based position/status
POST /api/public/message               → submit a public message
POST /api/public-messages/mode         → select automatic or moderated intake
POST /api/public-messages/settings     → change the persistent per-IP submission limit
POST /api/public-messages/:id/approve  → approve one pending message
POST /api/public-messages/:id/reject   → reject/remove one pending or queued message
POST /api/public-messages/next         → play the next approved message immediately
POST /api/event                        → { type:'kick', on:bool, color:'#rrggbb', brightness:0..1 }
POST /api/media                        → prepared RGB frames from the admin upload UI
POST /api/media/:id/play               → play one exact image/GIF
DELETE /api/media/:id                  → remove an unused image/GIF
POST /api/scene                        → save { name, loop, cues }
POST /api/scenes                       → create and select an empty scene
POST /api/scenes/:id/select            → select the scene to edit/play
DELETE /api/scenes/:id                 → delete a scene that is not playing
POST /api/scene/play                   → play the scene from cue 1
POST /api/scene/previous               → replay the previous cue
POST /api/scene/next                   → advance immediately
POST /api/scene/stop                   → stop the scene and return to AUTO
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

**`media.json`** is generated after an upload and is intentionally ignored by Git. It stores a library of up to 30 media entries. The browser accepts PNG, JPEG, WebP and GIF files up to 8 MB, scales them to the panel, and sends at most 180 RGB frames per entry. GIF decoding is bundled locally, so it also works when the Raspberry Pi access point has no Internet connection.

**`scene.json`** stores up to 30 named scenes and remembers the selected one. Existing single-scene files are migrated automatically. Each cue has an effect and its own minimum duration. Color-capable effects snapshot their AUTO color/rainbow settings when added, and those values can then be edited independently. Text cues snapshot the chosen message look, while media cues reference one exact library entry. At the end, the scene either loops or returns to the weighted AUTO scheduler. In AUTO mode, scene cues and their private settings are ignored completely.

**`messages.json`** is generated at runtime and ignored by Git. It stores the
public-message mode (`automatic` or `moderated`), pending approvals, the FIFO
display queue and a short history. The `public_messages` effect becomes eligible
for weighted AUTO selection only while an approved message is waiting, and shows
one message per selection. Its `duration` is a minimum: short messages loop until
that duration expires, while long messages always finish at least one complete
pass. A message interrupted before its first complete pass is returned to the
front of the queue.

`EFFECT_DEFAULTS` in `server.js` provides fallback values so the server works correctly even if `effects.json` reverts (Google Drive sync issue).

Public submission protection defaults to a 20-second cooldown, 3 submissions
per IP in 5 minutes, 30 globally per minute and 50 active messages in total.
The per-IP limit is persistent and editable from the admin UI; it controls both
the rolling submission limit and the number of active messages for that IP. The
initial value and other limits can also be adjusted before startup with:

```ini
PUBLIC_COOLDOWN_SECONDS=20
PUBLIC_RATE_LIMIT=3
PUBLIC_RATE_WINDOW_SECONDS=300
PUBLIC_GLOBAL_RATE_LIMIT=30
```

---

## Running

```bash
npm install
node server.js
```

On startup the console prints all network IPs. Open the administration page using the computer or hotspot IP:
```
http://192.168.x.x:3000/admin/
```

If the phone can't connect, allow the port through Windows Firewall:
```powershell
netsh advfirewall firewall add rule name="Panel Controller" dir=in action=allow protocol=TCP localport=3000
```

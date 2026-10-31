# Portable project context — 2026-10-31

This captures decisions and implementation state for another computer/assistant.
It is **not the complete chat transcript**. Verify details against code and tests.

## Resume elsewhere

While online, with GitHub SSH access configured:

```bash
git clone git@github.com:AloisKyrou/led_screen_controller.git
cd led_screen_controller
npm ci
npm test
git rev-parse HEAD
```

Open that folder in the coding assistant and paste:

> Read AGENTS.md, CONTEXT_HANDOFF.md, DEPLOY_RPI.md and README.md. Inspect git
> status and recent commits. Continue the NOOLS 60x15 LED panel project while
> preserving user changes and Pi runtime data. Deployment uses SCP/SSH over the
> Pi's own Wi-Fi, without giving it Internet. Verify the handoff against current
> code and tests. My next request is: [describe the next task].

Retain the hash from `git rev-parse HEAD` to recover this exact source revision
later; main can advance. Cloning transfers tracked code/docs, not the conversation,
Pi settings/uploads, credentials or untracked files. Retrieve runtime state from
the Pi separately when needed and keep it private. Wi-Fi QR codes contain the
network password and are intentionally excluded from Git.

## Environment and operating decisions

- Repository: `AloisKyrou/led_screen_controller`, branch `main`. Prior published
  baseline `1ef786d`; the commit containing this file includes later features.
- Node/Express and vanilla browser UI, 60x15 WS2812B panel, ArtNet at about 30 FPS.
- Pi: `alois@192.168.50.1` on `NOOLS-HOSTAPD`, application
  `/home/alois/led-screen-controller`, service `led-screen.service`.
- Follow [DEPLOY_RPI.md](DEPLOY_RPI.md). Preserve AP/Ethernet networking and
  runtime data. Never copy Windows node_modules to Linux/ARM.
- Git/tests do not establish which version is installed on the physical Pi.
- Logitech G35 USB microphone worked on the Pi with
  `plughw:CARD=Headset,DEV=0`; capture mono S16_LE, 16000 Hz.

## Code map

- `server.js`: API, persistence, scheduler/scenes, KICK composition and output.
- `public/app.js`, `public/index.html`: admin controls/audio monitoring.
- `effects/`: effect modules; `effects/media.js`: saved GIF/image playback.
- `lib/audio-input.js`: capture/demo, FFT, kick detection.
- `lib/kick-envelope.js`, `lib/output-brightness.js`: envelopes and output scale.
- `lib/spectrum-ball.js`: ball physics; `lib/rave-pixels.js`: NOOLS/rave visuals;
  `lib/halloween.js`: procedural Halloween art.
- `public/panel-gif.js`: GIF codec/editor support; `public/halloween-gifs/`:
  downloadable animations.
- `test/`, `test-support/server.js`: Node tests and isolated temporary servers.
- Runtime state: effects/text/scene/media/messages/audio JSON and `public-gifs/`.
  Some defaults are tracked; never copy them over Pi state during deployment.

## Current behavior and design choices

### Messages and GIFs

Guest text defaults to uppercase and rainbow; lowercase is opt-in. GIF editor
canvas is forced to 60x15. Upload limits: 512 KiB, 120 frames, 15 seconds, correct
dimensions. Guest GIFs require approval with admin preview/download. Played
entries remain visible with replay/discard/save-to-library actions.

Saved media can be enabled/disabled for AUTO without deletion. Each GIF has a
relative weight 1–10; the media category has a weight slider up to 100. First
choose a category, then a weighted eligible GIF. Explicit playback bypasses
random selection.

### Audio and KICK

Audio enable saves immediately; off stops capture and filters audio effects
from selection and scenes, preserving their selections for reactivation. Other
capture settings use Apply. Kick detection uses bass only (about 47–172 Hz),
its own history, attack/rearm/minimum interval and noise floor. It does not
compare bass against the entire spectrum. Adaptive mode uses recent robust
statistics; higher sensitivity detects weaker hits. Manual threshold is grayed
out while adaptive mode is on. Noise gate is minimum level after gain, not dB.

Manual KICK and Audio → KICK share settings. Flash/shockwave are overlays while
the background keeps animating. Opacity blends with the background. Attack and
descent support flash and brightness boost; repeated kicks restart from the
current envelope level. Settings saves are serialized to avoid stale responses.

- Dedicated Kick flash/Kick choc temporarily force audio triggering for their
  duration, with their own sensitivity (default 2), without changing the saved
  global trigger toggle. Audio capture must still be enabled.
- Each effect and GIF can disable flash/shockwave overlays while allowing
  brightness boosts. Forced KICK colour priority: GIF, effect, shared settings.
  Colour overrides do not re-enable blocked overlays.
- Global brightness boost raises master brightness toward its configured target.
- **Booster Bright au kick**, the latest addition, raises the selected effect's
  own Bright toward 100%, then returns with the shared envelope. Master brightness
  still multiplies it. Works with Audio → KICK off and overlays disabled without
  enabling them. At Bright 100% there is no headroom. Checkbox persists; envelope
  resets on effect changes. See `test/effect_brightness_bump.test.js`.
- Brightness output scaling must copy frames, not mutate persistent effect
  canvases: this fixed fading pixels disappearing too quickly at low brightness.

### Visuals and controls

- Spectrum bars are green/orange/red; peak markers fall slower than bars but
  were accelerated. Two 2x2 complementary-colour balls have gravity, irregular
  jumps/ceiling rebounds and slow floor movement in silence. Contact displays
  ULTRA NOOL at the top, above the bars.
- Retro scope has DC removal and stronger gain; default reactivity 2 approximates
  the previous multiplier 8. Browser monitor resolution differs from the panel.
  A separate frequency-line scope was discussed but **not implemented**; clarify
  the desired appearance if revisited.
- Audio pumping circles remain separate from the original effect and use
  low/mid/high bands, adaptive range and subpixel intensity.
- Pharmacy tunnel, thin NOOL scatter and NOL chaos are available. Chaos now
  periodically gathers into stationary, twinkling NOOLS before scattering again.
- Halloween: pumpkin groove/jump, ghosts, spiders, bats and skeleton. Jump stays
  visible and rotates without kicks; kicks zoom it. Groove uses recognizable
  native-pixel pumpkins. Skeleton fills height proportionally (about 17x15),
  keeps small 2x2 eyes, with hands at the sides; do not stretch it across 60 pixels.
- Eight downloadable Halloween GIFs are bundled; library import is explicit.
- `RETIRED_EFFECTS` keeps these modules out of UI/scheduling without deleting
  code: fete_trouble, moving_tile_puzzle, fillscreen_snakewise, bouncing_balls,
  audio_cauldron, audio_monster_mouth, audio_watching_eyes.
- Scene/cue controls collapse behind a button, hidden by default and remembered
  locally; hiding does not stop playback.

## Verification and next checks

Run `npm test` and `git diff --check` before publishing. Tests cover GIF validation,
media persistence/weights, audio, KICK modes/colour, Bright bump and visuals.
They use temporary servers and synthetic audio, not real hardware.

Validation for this snapshot: all 87 tests passed with
`npm test -- --test-concurrency=1`; the default parallel run had two 30-second
timeouts (migration and public GIF integration). Sequential execution passed
both without code changes. `git diff --check` also passed.

After deployment, physically check local Bright bump with master below 100%,
Audio → KICK off and overlays disabled; saved baseline must remain unchanged.
Also verify audio toggle persistence, low-brightness fading pixels, GIF weights,
per-GIF overlay controls, and latest Halloween/NOOLS visuals. Do not claim local
tests prove physical rendering or microphone responsiveness.

The related portfolio page is in another repository, previously located at
`C:\travail\projects\portfolio\src\views\portfolio\art_pieces\PanneauLed.vue`.
Its changes are not included here; the path may differ on another computer.

# web-hand

Client-side hand-tracked 3D playground. WebGPU rendering when available,
WebGL2 fallback. Hand tracking via MediaPipe Hand Landmarker (GPU delegate
in the browser). Everything runs locally — no frames leave the device.

## Run

```sh
npm install
npm run dev
```

Open `http://localhost:5173`, click **Start**, allow camera access.

## Features

| Gesture | Effect |
|---|---|
| Index finger extended (others curled) | 3D pointer cursor with hover highlight |
| Pinch (thumb-index touch) | Air-tap on hovered object |
| Closed fist | Grab & translate the object the palm is over |
| Open palm | Releases held object / cancels |
| Both hands pinching, hands moving apart/together | Zoom (camera dolly) |
| Both hands pinching, twisting | Rotate the world pivot |
| 1 / 2 / 3 fingers extended | Switch mode: pointer / move / draw |
| Pinch & drag in `draw` mode | 3D air-draw |

### Keyboard

- `F` — pause/freeze inference (great for inspecting landmark overlay)
- `L` — toggle landmark overlay
- `1-6` — focus a gesture in the "Why?" panel

## Noise / mis-action prevention

Layered, in this order:

1. **One Euro Filter** on every landmark axis (adaptive low-pass).
2. **Velocity gate** — drops physically-impossible jumps before they hit
   the filter (clamps to previous landmark).
3. **Hysteresis** on every binary gesture — separate enter/exit thresholds
   prevent flicker around the boundary.
4. **Min-hold-time debounce** — gestures must hold steady for `holdMs`
   before they activate.
5. **Confidence-weighted activation** — combines model presence score
   with geometric score.
6. **Cooldowns** between mode switches and discrete events (e.g. taps).

Every threshold is live-tunable in the Tweakpane on the right.

## Debugging

Three panels are always visible:

- **HUD** (top-left): mode, FPS, inference ms, hand count.
- **Why didn't it fire?** (mid-left): for the focused gesture, lists each
  condition and whether it passed. Cycle gestures with `1`-`6`.
- **Log console** (bottom-left): app-wide log feed with level filtering.
- **Tuning panel** (right): every parameter from `src/config/parameters.ts`.

Toggle "show raw landmarks" in the tuning panel to see un-filtered points
overlaid on the smoothed ones — that's how you tell whether the smoother
is the source of any feel issue.

## Architecture

The codebase is intentionally split into single-responsibility folders.
**Anyone contributing should be able to find the right file in <30s.**

```
src/
  config/        types and tunables; nothing else allowed in here
  util/          pure math helpers
  filters/       One Euro Filter + landmark smoother
  tracking/      camera + MediaPipe wrapper (the only place ML code lives)
  gestures/      one file per gesture, all pure functions of (frame, prev) → next
  scene/         Three.js scene, demo objects, ray casting
  interaction/   the only place that maps gestures → scene actions
  debug/         logger, overlay, stats, Tweakpane tuner, why-panel
  main.ts        entry point — wires the above together
```

### Adding a new gesture

1. Create `src/gestures/<name>.ts` exporting a `GestureDetector`.
2. Add it to the `detectors` array in `src/gestures/index.ts`.
3. Add any new tunables to `src/config/parameters.ts` (with defaults).
4. (Optional) react to it in `src/interaction/interactionController.ts`.
5. (Optional) add it to the focus-cycle in `src/main.ts` and the
   options list in `src/debug/tuner.ts`.

### Pure-function gesture contract

```ts
detect(input: FrameInput, prev: GestureState<T>, ctx: GestureContext): GestureState<T>
```

Detectors must not mutate `prev`, must not allocate inside hot paths
beyond what's necessary, and must populate `state.conditions[]` with
debug-friendly labels — that's what powers the "Why?" panel.

## Notes

- Models are fetched from Google's CDN on first run (~7 MB). Subsequent
  loads are cached by the browser.
- Tested on macOS Safari 18 (WebGPU) and Chrome 130 (WebGPU + WebGL2).
- Does not push camera frames anywhere; everything is local.

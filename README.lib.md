# @kawapiki/handcontrol

Hand-tracked input for any website. Mid-air cursor, click, scroll, zoom, rotate, and per-hand pose events from a webcam — powered by MediaPipe + WebGPU.

```ts
import {
  HandControl,
  DomBridge,
} from '@kawapiki/handcontrol';

const handControl = new HandControl({
  getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
});

handControl.events.on('cursor',     (e) => { /* {x, y, visible, handId} */ });
handControl.events.on('pinchStart', (e) => { /* click candidate */ });
handControl.events.on('pinchEnd',   (e) => { /* totalDx/dy, vx/vy */ });
handControl.events.on('zoom',       (e) => { /* delta */ });
handControl.events.on('rotate',     (e) => { /* delta in rad */ });
handControl.events.on('handPose',   (e) => { /* dRoll, dPitch */ });
```

You bring your own MediaPipe tracker, smoother, and per-frame loop. The package gives you the **event layer**: pure functions consuming gesture states and emitting semantic events. Or use the included `HandTracker` + `GestureRuntime` to get a turnkey pipeline.

## Architecture

```
camera frame
    │
    ▼
HandTracker (MediaPipe + smoothing + bone-length topology)
    │  HandFrame[] per call
    ▼
GestureRuntime (pinch, point, openPalm, twoHandZoom, twoHandRotate)
    │  GestureState map
    ▼
HandControl (sources fan out to events)
    │  cursor / pinch* / zoom / rotate / handPose
    ▼
your DOM, your 3D scene, your game …
```

## Configuration

Every threshold is live-tunable. Pass a `getConfig()` callback to `HandTracker` and `GestureRuntime`; both call it every frame so changes propagate immediately.

```ts
import {
  HandTracker, GestureRuntime, defaultGestureConfig,
} from '@kawapiki/handcontrol';

const config = structuredClone(defaultGestureConfig);
const tracker = new HandTracker(() => config);
const runtime = new GestureRuntime(() => config);

// Later, mutate `config.pinch.enter = 0.4` — takes effect next frame.
```

## Peer dependency

Install MediaPipe yourself so it's deduped with the rest of your bundle:

```bash
npm install @kawapiki/handcontrol @mediapipe/tasks-vision
```

The package weighs ~8 KB gzipped. MediaPipe's WASM is loaded from the official CDN by default; pass an alternate `WASM_BASE` if you want to host it yourself.

## DOM bridge

To control a webpage with a hand cursor, use the included `DomBridge`:

```ts
import { DomBridge } from '@kawapiki/handcontrol';

const bridge = new DomBridge(handControl, {
  iframe: document.getElementById('target') as HTMLIFrameElement,
  cursorEl: document.getElementById('hand-cursor') as HTMLElement,
});
bridge.attach();
```

The bridge dispatches synthetic `mousedown`/`mouseup`/`click` on pinch and forwards `scrollBy` on pinch-drag.

## License

MIT.

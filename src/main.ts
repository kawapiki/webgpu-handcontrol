/**
 * Entry point. Wires together: camera → tracker → gestures → controller →
 * scene + debug surface. Keep this file small — anything domain-specific
 * lives in its own module.
 */

import './styles.css';

import { Calibrator } from './calibration/calibrator.js';
import { CalibrationOverlay } from './calibration/overlay.js';
import { calibrationPhases } from './calibration/scripts.js';
import { loadCalibration } from './calibration/storage.js';
import { params } from './config/parameters.js';
import { logger } from './debug/logger.js';
import { LandmarkOverlay } from './debug/overlay.js';
import { Stats } from './debug/stats.js';
import { buildTuner } from './debug/tuner.js';
import { WhyPanel } from './debug/whyPanel.js';
import { GestureRuntime } from './gestures/index.js';
import { InteractionController } from './interaction/interactionController.js';
import { HandMesh } from './scene/handMesh.js';
import { createScene } from './scene/scene.js';
import { createSceneManager } from './scene/scenes/index.js';
import { startCamera } from './tracking/camera.js';
import { HandTracker } from './tracking/handTracker.js';

function $<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`main: missing element ${sel}`);
  return el;
}

async function bootstrap(): Promise<void> {
  // Wire up the in-page logger first so subsequent setup errors land in the UI.
  logger.attach($('#log-list') as HTMLOListElement, $('#log-toolbar') as HTMLDivElement);
  logger.info('booting…');

  const sceneCanvas = $<HTMLCanvasElement>('#scene');
  const overlayCanvas = $<HTMLCanvasElement>('#overlay');
  const videoEl = $<HTMLVideoElement>('#cam');
  const modeBadge = $('#mode-badge');
  const fpsEl = $('#fps');
  const inferEl = $('#infer');
  const handsEl = $('#hands');

  // Boot dialog — must be triggered by a user gesture for getUserMedia &
  // (potentially) audio context permissions.
  const boot = $('#boot');
  const bootBtn = $<HTMLButtonElement>('#boot-btn');
  await new Promise<void>((resolve) => {
    bootBtn.addEventListener('click', () => resolve(), { once: true });
  });
  boot.classList.add('hidden');

  await startCamera({ videoEl, width: 1280, height: 720 });

  const sceneHandles = await createScene(sceneCanvas);
  const sceneManager = createSceneManager(sceneHandles.worldPivot);
  const handMesh = new HandMesh();
  // Attach to scene root, not worldPivot — the visual hand should stay in
  // the user's reference frame even when two-hand-rotate spins the world.
  handMesh.attachTo(sceneHandles.scene);

  const overlay = new LandmarkOverlay(overlayCanvas);
  const stats = new Stats(fpsEl, inferEl, handsEl);
  const why = new WhyPanel($('#why-panel'));

  const tracker = new HandTracker();
  await tracker.init();

  const runtime = new GestureRuntime();
  const controller = new InteractionController(
    { camera: sceneHandles.camera, worldPivot: sceneHandles.worldPivot },
    sceneManager,
    modeBadge,
  );

  const calOverlay = new CalibrationOverlay($('#calibration'));
  const calibrator = new Calibrator(calOverlay);

  const hadSavedProfile = loadCalibration();
  if (hadSavedProfile) logger.info('loaded saved calibration from cookie');

  const tuner = buildTuner(sceneManager, () => calibrator.start(calibrationPhases));

  // Resize handling — both the WebGL canvas and the overlay canvas need
  // independent sizing because the overlay sits over the camera preview.
  const onResize = () => {
    sceneHandles.resize(window.innerWidth, window.innerHeight);
    overlay.resize(overlayCanvas.clientWidth, overlayCanvas.clientHeight);
  };
  window.addEventListener('resize', onResize);
  onResize();

  // Keyboard shortcuts.
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'f' || ev.key === 'F') {
      params.debug.paused = !params.debug.paused;
      tuner.pane.refresh();
      logger.info(`paused: ${params.debug.paused}`);
    }
    if (ev.key === 'l' || ev.key === 'L') {
      params.debug.showLandmarks = !params.debug.showLandmarks;
      tuner.pane.refresh();
    }
    if (ev.key >= '1' && ev.key <= '6') {
      const map = ['point', 'pinch', 'grab', 'open_palm', 'two_hand_zoom', 'two_hand_rotate'];
      const idx = Number(ev.key) - 1;
      const target = map[idx]!;
      tuner.setFocusedGesture(target);
      why.setTarget(target);
    }
    if (ev.key === '[') sceneManager.cycle(-1);
    if (ev.key === ']') sceneManager.cycle(1);
  });

  let prevTimestamp = performance.now();
  const loop = () => {
    const now = performance.now();
    if (!params.debug.paused) {
      const inferStart = performance.now();
      const frame = tracker.detect(videoEl, now);
      const inferMs = performance.now() - inferStart;

      if (calibrator.isActive()) {
        // During calibration we still draw the landmark overlay so the user
        // can confirm tracking, but we do NOT step the gesture runtime or
        // scene controller — that would react to the same hand poses we're
        // sampling for thresholds.
        calibrator.step(frame, now);
        overlay.draw(frame.hands);
      } else {
        const states = runtime.step(frame, now, prevTimestamp);
        controller.step(frame.hands, states, now);
        overlay.draw(frame.hands);
        why.setTarget(tuner.getFocusedGesture());
        why.update(states);
      }
      handMesh.update(frame.hands, sceneHandles.camera);
      stats.recordFrame(inferMs, frame.hands.length);
    }
    sceneHandles.render();
    prevTimestamp = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Auto-launch the wizard on the very first visit. Returning users get
  // their saved cookie and can recalibrate via the Tweakpane button.
  if (!hadSavedProfile) {
    logger.info('first launch — starting calibration wizard');
    calibrator.start(calibrationPhases);
  }

  logger.info('ready. Hold up a hand!');
}

bootstrap().catch((err) => {
  logger.error(`bootstrap failed: ${(err as Error).message}`);
  console.error(err);
});

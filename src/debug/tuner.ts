/**
 * Tweakpane bindings for every tunable parameter. All bindings write
 * directly to the singleton `params` object — no separate "apply" step,
 * which means tuning is instantly visible in the running app.
 *
 * To add a new knob:
 *   1. Add the field to `Parameters` in config/parameters.ts.
 *   2. Add a `pane.addBinding(...)` call below.
 */

import { Pane } from 'tweakpane';

import { defaultParameters, params } from '../config/parameters.js';
import type { SceneManager } from '../scene/scenes/index.js';

export interface TunerHandles {
  pane: Pane;
  /** Set the gesture being interrogated by the "Why?" panel. */
  setFocusedGesture: (name: string) => void;
  /** Read the current focused gesture. */
  getFocusedGesture: () => string;
}

export function buildTuner(sceneManager: SceneManager, onRecalibrate: () => void): TunerHandles {
  const pane = new Pane({ title: 'web-hand · tuning', expanded: true });

  const focus = { gesture: 'pinch' };

  const fScenePicker = pane.addFolder({ title: 'Scene' });
  const sceneState = { name: sceneManager.active.name };
  const sceneOptions = Object.fromEntries(sceneManager.list().map((s) => [s.label, s.name]));
  fScenePicker
    .addBinding(sceneState, 'name', { label: 'active', options: sceneOptions })
    .on('change', (ev) => sceneManager.setActiveByName(ev.value));

  const fCalibrate = pane.addFolder({ title: 'Calibration' });
  fCalibrate.addButton({ title: 'Re-run wizard' }).on('click', onRecalibrate);

  const fSmooth = pane.addFolder({ title: 'Smoothing (One Euro)' });
  fSmooth.addBinding(params.smoothing, 'minCutoff', { min: 0.1, max: 5, step: 0.05 });
  fSmooth.addBinding(params.smoothing, 'beta', { min: 0, max: 0.5, step: 0.005 });
  fSmooth.addBinding(params.smoothing, 'dCutoff', { min: 0.1, max: 5, step: 0.05 });

  const fGate = pane.addFolder({ title: 'Velocity gate' });
  fGate.addBinding(params.velocityGate, 'maxNormPerSecond', { min: 1, max: 20, step: 0.5 });

  const fDet = pane.addFolder({ title: 'Detection' });
  fDet.addBinding(params.detection, 'minHandScore', { min: 0, max: 1, step: 0.01 });

  const fPinch = pane.addFolder({ title: 'Pinch' });
  fPinch.addBinding(params.pinch, 'enter', { min: 0.1, max: 1, step: 0.01 });
  fPinch.addBinding(params.pinch, 'exit', { min: 0.1, max: 1.5, step: 0.01 });
  fPinch.addBinding(params.pinch, 'tapHoldMs', { min: 0, max: 500, step: 10 });
  fPinch.addBinding(params.pinch, 'tapCooldownMs', { min: 0, max: 1000, step: 10 });

  const fPoint = pane.addFolder({ title: 'Point' });
  fPoint.addBinding(params.point, 'indexExtendedMax', { min: 0, max: 0.6, step: 0.01 });
  fPoint.addBinding(params.point, 'othersCurledMin', { min: 0.2, max: 1, step: 0.01 });
  fPoint.addBinding(params.point, 'holdMs', { min: 0, max: 500, step: 10 });

  const fGrab = pane.addFolder({ title: 'Grab' });
  fGrab.addBinding(params.grab, 'enter', { min: 0.3, max: 1, step: 0.01 });
  fGrab.addBinding(params.grab, 'exit', { min: 0.2, max: 0.95, step: 0.01 });
  fGrab.addBinding(params.grab, 'holdMs', { min: 0, max: 500, step: 10 });

  const fPalm = pane.addFolder({ title: 'Open palm' });
  fPalm.addBinding(params.openPalm, 'maxCurl', { min: 0, max: 0.5, step: 0.01 });
  fPalm.addBinding(params.openPalm, 'holdMs', { min: 0, max: 1000, step: 10 });

  const fTwo = pane.addFolder({ title: 'Two-hand' });
  fTwo.addBinding(params.twoHand, 'minBothScore', { min: 0, max: 1, step: 0.01 });
  fTwo.addBinding(params.twoHand, 'zoomDeadzone', { min: 0, max: 0.05, step: 0.001 });
  fTwo.addBinding(params.twoHand, 'rotateDeadzone', { min: 0, max: 0.2, step: 0.001 });

  const fScene = pane.addFolder({ title: 'Scene' });
  fScene.addBinding(params.scene, 'fov', { min: 30, max: 100, step: 1 });
  fScene.addBinding(params.scene, 'zoomGain', { min: 0.5, max: 20, step: 0.1 });
  fScene.addBinding(params.scene, 'grabGain', { min: 0.5, max: 20, step: 0.1 });

  const fHandMesh = pane.addFolder({ title: 'Hand mesh (3D)' });
  fHandMesh.addBinding(params.handMesh, 'show');
  fHandMesh.addBinding(params.handMesh, 'depth', { min: 1.5, max: 8, step: 0.1 });
  fHandMesh.addBinding(params.handMesh, 'zScale', { min: 0, max: 12, step: 0.1 });

  const fDebug = pane.addFolder({ title: 'Debug' });
  fDebug.addBinding(params.debug, 'showLandmarks');
  fDebug.addBinding(params.debug, 'showRawLandmarks');
  fDebug.addBinding(params.debug, 'paused');

  fDebug.addBinding(focus, 'gesture', {
    options: {
      pinch: 'pinch',
      point: 'point',
      grab: 'grab',
      open_palm: 'open_palm',
      two_hand_zoom: 'two_hand_zoom',
      two_hand_rotate: 'two_hand_rotate',
    },
  });

  fDebug.addButton({ title: 'Reset to defaults' }).on('click', () => {
    Object.assign(params.smoothing, defaultParameters.smoothing);
    Object.assign(params.velocityGate, defaultParameters.velocityGate);
    Object.assign(params.detection, defaultParameters.detection);
    Object.assign(params.pinch, defaultParameters.pinch);
    Object.assign(params.point, defaultParameters.point);
    Object.assign(params.grab, defaultParameters.grab);
    Object.assign(params.openPalm, defaultParameters.openPalm);
    Object.assign(params.twoHand, defaultParameters.twoHand);
    Object.assign(params.scene, defaultParameters.scene);
    Object.assign(params.debug, defaultParameters.debug);
    pane.refresh();
  });

  return {
    pane,
    setFocusedGesture: (n: string) => {
      focus.gesture = n;
      pane.refresh();
    },
    getFocusedGesture: () => focus.gesture,
  };
}

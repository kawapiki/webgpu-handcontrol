/**
 * All runtime-tunable parameters live here.
 *
 * Each value has a sensible default; the Tweakpane debug panel binds directly
 * to this object so you can tune live without reloading. Keep them grouped by
 * subsystem and avoid magic numbers anywhere else in the codebase.
 *
 * Threshold pairs use hysteresis: `*Enter` >= `*Exit`. A gesture turns on when
 * its score crosses the enter threshold, and only turns off again when it
 * drops below the exit threshold. This is the single most effective trick for
 * preventing flicker on noisy gestures.
 */

export interface Parameters {
  smoothing: {
    /** One Euro Filter: minimum cutoff (Hz). Lower = smoother but laggier. */
    minCutoff: number;
    /** One Euro Filter: speed coefficient. Higher = follows fast moves better. */
    beta: number;
    /** One Euro Filter: derivative cutoff (Hz). */
    dCutoff: number;
  };

  velocityGate: {
    /** Reject any landmark jump greater than this fraction of image width per second. */
    maxNormPerSecond: number;
  };

  detection: {
    /** Minimum model confidence to keep a detected hand. */
    minHandScore: number;
    /** Maximum number of hands to track. */
    maxHands: number;
  };

  pinch: {
    /** Pinch distance (thumb-tip ↔ index-tip, normalised by hand scale) below which we say "pinched". */
    enter: number;
    /** Above this distance the pinch is released. */
    exit: number;
    /** ms a pinch must hold before counting as an "air-tap" event. */
    tapHoldMs: number;
    /** ms cooldown between air-tap events to prevent double-fires. */
    tapCooldownMs: number;
  };

  point: {
    /** Index curl below this means "extended". */
    indexExtendedMax: number;
    /** Other fingers (middle/ring/pinky) curl above this means "curled". */
    othersCurledMin: number;
    /** ms this configuration must persist before the gesture is active. */
    holdMs: number;
  };

  openPalm: {
    /** Mean curl below this means open. */
    maxCurl: number;
    /** ms the palm must remain open before triggering. */
    holdMs: number;
  };

  twoHand: {
    /** Both hands must score above this to enable two-hand gestures. */
    minBothScore: number;
    /** Minimum frame-to-frame change in inter-hand distance to update zoom. */
    zoomDeadzone: number;
    /** Minimum frame-to-frame change in inter-hand twist angle (rad) to update rotation. */
    rotateDeadzone: number;
    /** Both hands must remain pinched this many ms before rotation engages (debounce). */
    rotateHoldMs: number;
    /** EMA smoothing factor for the inter-palm angle (0 = no smoothing, 1 = freeze). */
    rotateSmoothing: number;
    /** Any frame-to-frame |Δangle| above this (rad) is treated as a glitch and zeroed. */
    rotateMaxStep: number;
  };

  objectRotate: {
    /** Multiplier from wrist-roll Δ (rad) to grabbed-object yaw Δ. */
    rollGain: number;
    /** Multiplier from wrist-pitch Δ (normalized z) to grabbed-object pitch Δ (rad). */
    pitchGain: number;
    /** Below this absolute Δroll the object is left alone (cuts jitter). */
    rollDeadzone: number;
    /** Below this absolute Δpitch the object is left alone. */
    pitchDeadzone: number;
  };

  scene: {
    /** Camera FOV in degrees. */
    fov: number;
    /** World-units multiplier when mapping pinch-zoom to camera distance. */
    zoomGain: number;
    /** World-units multiplier when mapping hand translation to dragged object motion. */
    dragGain: number;
  };

  depth: {
    /** Image-plane hand size (wrist→middle-MCP, normalized) at which `baseDepth` is used. */
    referenceScale: number;
    /** Depth (world units) when the hand is at reference size. */
    baseDepth: number;
    /** World units gained per unit of (handSize / referenceScale − 1). Positive = bigger hand pushes deeper. */
    gain: number;
    /** Lower clamp on estimated depth. */
    min: number;
    /** Upper clamp on estimated depth. */
    max: number;
  };

  handMesh: {
    /** Whether to render the 3D hand skeleton in-scene. */
    show: boolean;
    /** Multiplier converting MediaPipe relative-z to per-finger depth offsets. */
    zScale: number;
    /**
     * Inverse-size gain. The hand mesh is scaled around its palm center by
     * `ratio^(-sizeInvertGain)`. Effect on apparent size on screen:
     *   0 = natural (close hand → big)
     *   1 = constant apparent size regardless of physical distance
     *   2 = inverted (close hand → small in scene; deep hand → big)
     * Tunable in Tweakpane; values above 2 give an exaggerated telescope feel.
     */
    sizeInvertGain: number;
  };

  debug: {
    /** Render the 2D landmark overlay on the camera feed. */
    showLandmarks: boolean;
    /** Render raw (pre-filter) landmarks as ghost dots. */
    showRawLandmarks: boolean;
    /** Pause the inference loop without dropping the camera. */
    paused: boolean;
  };
}

export const defaultParameters: Parameters = {
  smoothing: {
    minCutoff: 1.0,
    beta: 0.05,
    dCutoff: 1.0,
  },
  velocityGate: {
    maxNormPerSecond: 25.0,
  },
  detection: {
    minHandScore: 0.5,
    maxHands: 2,
  },
  pinch: {
    enter: 0.35,
    exit: 0.55,
    tapHoldMs: 80,
    tapCooldownMs: 250,
  },
  point: {
    indexExtendedMax: 0.25,
    othersCurledMin: 0.55,
    holdMs: 80,
  },
  openPalm: {
    maxCurl: 0.2,
    holdMs: 150,
  },
  twoHand: {
    minBothScore: 0.6,
    zoomDeadzone: 0.005,
    rotateDeadzone: 0.005,
    rotateHoldMs: 80,
    rotateSmoothing: 0.35,
    rotateMaxStep: 0.5,
  },
  objectRotate: {
    rollGain: 1.0,
    pitchGain: 4.0,
    rollDeadzone: 0.005,
    pitchDeadzone: 0.003,
  },
  scene: {
    fov: 55,
    zoomGain: 6.0,
    dragGain: 4.0,
  },
  depth: {
    referenceScale: 0.16,
    baseDepth: 3.5,
    gain: 2.5,
    min: 1.5,
    max: 7.0,
  },
  handMesh: {
    show: true,
    zScale: 4.0,
    sizeInvertGain: 2.0,
  },
  debug: {
    showLandmarks: true,
    showRawLandmarks: false,
    paused: false,
  },
};

/** Singleton mutable params instance — Tweakpane writes to this object. */
export const params: Parameters = structuredClone(defaultParameters);

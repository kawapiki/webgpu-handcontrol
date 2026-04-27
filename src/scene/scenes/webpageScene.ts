/**
 * "Webpage" demo scene. Overlays a same-origin demo HTML page in an
 * iframe and lets the user control it entirely with one hand:
 *
 *   point  →  cursor moves over the page (visible disc)
 *   pinch  →  click the element under the cursor (if drift was small)
 *   pinch + vertical drag  →  scroll the iframe
 *
 * The actual translation gesture-state → DOM is owned by `DomBridge`
 * in `src/control/domBridge.ts`; this file just hosts the DOM
 * elements and wires the lifecycle. All static styling lives in
 * `src/styles.css` under `#webpage-overlay` / `#webpage-cursor`.
 */

import * as THREE from 'three/webgpu';

import { DomBridge } from '../../control/domBridge.js';
import type { HandControl } from '../../control/handControl.js';
import { logger } from '../../debug/logger.js';
import type { DemoScene, SceneStepInput } from './types.js';

const DEFAULT_PAGE_URL = './demo-page.html';

export interface WebpageSceneOptions {
  /** URL loaded into the iframe. Must be same-origin for click/scroll dispatch to work. */
  pageUrl?: string;
}

export class WebpageScene implements DemoScene {
  readonly name = 'webpage';
  readonly label = 'Webpage';
  readonly root = new THREE.Group();

  private readonly overlay: HTMLDivElement;
  private readonly iframe: HTMLIFrameElement;
  private readonly cursorEl: HTMLDivElement;
  private readonly bridge: DomBridge;

  constructor(handControl: HandControl, options: WebpageSceneOptions = {}) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'webpage-overlay';
    this.overlay.classList.add('hidden');

    this.iframe = document.createElement('iframe');
    this.iframe.src = options.pageUrl ?? DEFAULT_PAGE_URL;
    this.iframe.title = 'Demo page';
    this.overlay.appendChild(this.iframe);

    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'webpage-cursor';
    this.cursorEl.classList.add('hidden');
    this.overlay.appendChild(this.cursorEl);

    this.bridge = new DomBridge(handControl, {
      iframe: this.iframe,
      cursorEl: this.cursorEl,
      onClick: (target) => {
        const tag = target?.tagName.toLowerCase() ?? '?';
        const text = target?.textContent?.slice(0, 40) ?? '';
        logger.info(`webpage click <${tag}> "${text.trim()}"`);
      },
    });
  }

  activate(): void {
    if (!this.overlay.isConnected) {
      const app = document.getElementById('app');
      (app ?? document.body).appendChild(this.overlay);
    }
    this.overlay.classList.remove('hidden');
    this.bridge.attach();
    this.root.visible = true;
  }

  deactivate(): void {
    this.bridge.detach();
    this.overlay.classList.add('hidden');
    this.root.visible = false;
  }

  step(_input: SceneStepInput): void { /* nothing to do per frame — bridge runs on events */ }
}

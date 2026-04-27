/**
 * DOM bridge. Subscribes to a HandControl instance and translates its
 * semantic events into DOM behaviour against a target iframe:
 *
 *   cursor  →  position a visible cursor element + hover/mousemove
 *   pinchStart  →  remember the element under the cursor as the click target
 *   pinchMove   →  if vertical drift > SCROLL_THRESHOLD, switch to scroll mode
 *   pinchEnd    →  if still in click mode (no scroll), dispatch a click on the start target
 *
 * Coordinate model: HandControl reports cursor positions in *host*
 * viewport CSS px. We subtract the iframe's bounding rect to translate
 * into iframe-document coordinates for `elementFromPoint`.
 *
 * The bridge is independent of the iframe's content as long as it's
 * same-origin (we ship our own demo page, so it always is).
 */

import type { HandControl } from './handControl.js';
import type { CursorEvent, PinchEndEvent, PinchEvent, PinchMoveEvent } from './types.js';

const SCROLL_THRESHOLD_PX = 8;
const CLICK_DRIFT_TOLERANCE_PX = 12;

export interface DomBridgeOptions {
  iframe: HTMLIFrameElement;
  cursorEl: HTMLElement;
  /** Optional callback when a click is dispatched (for logging). */
  onClick?: (target: Element | null) => void;
}

export class DomBridge {
  private startTarget: Element | null = null;
  private mode: 'idle' | 'click' | 'scroll' = 'idle';
  private accDy = 0;
  private unsubs: Array<() => void> = [];

  constructor(private hc: HandControl, private opts: DomBridgeOptions) {}

  attach(): void {
    if (this.unsubs.length > 0) return;
    this.unsubs.push(
      this.hc.events.on('cursor',     (e) => this.onCursor(e)),
      this.hc.events.on('pinchStart', (e) => this.onPinchStart(e)),
      this.hc.events.on('pinchMove',  (e) => this.onPinchMove(e)),
      this.hc.events.on('pinchEnd',   (e) => this.onPinchEnd(e)),
    );
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.opts.cursorEl.classList.add('hidden');
  }

  private onCursor(e: CursorEvent): void {
    const { cursorEl } = this.opts;
    if (!e.visible) {
      cursorEl.classList.add('hidden');
      return;
    }
    cursorEl.classList.remove('hidden');
    cursorEl.style.transform = `translate3d(${e.x}px, ${e.y}px, 0) translate(-50%, -50%)`;
  }

  private onPinchStart(e: PinchEvent): void {
    this.mode = 'click';
    this.accDy = 0;
    this.startTarget = this.elementUnder(e.x, e.y);
    this.opts.cursorEl.classList.add('pinching');
  }

  private onPinchMove(e: PinchMoveEvent): void {
    this.accDy += e.dy;
    if (this.mode === 'click' && Math.abs(this.accDy) > SCROLL_THRESHOLD_PX) {
      this.mode = 'scroll';
    }
    if (this.mode === 'scroll') {
      const win = this.opts.iframe.contentWindow;
      // Inverted: pulling DOWN with the hand should scroll content DOWN
      // (which means scrollTop INCREASES).
      win?.scrollBy(0, e.dy);
    }
  }

  private onPinchEnd(e: PinchEndEvent): void {
    this.opts.cursorEl.classList.remove('pinching');

    if (this.mode === 'click' && this.startTarget) {
      const drift = Math.hypot(e.totalDx, e.totalDy);
      const endTarget = this.elementUnder(e.x, e.y);
      if (drift < CLICK_DRIFT_TOLERANCE_PX && endTarget === this.startTarget) {
        this.dispatchClick(endTarget, e.x, e.y);
        this.opts.onClick?.(endTarget);
      }
    }
    // Kinetic scroll-on-release could go here if we wanted momentum.
    this.mode = 'idle';
    this.accDy = 0;
    this.startTarget = null;
  }

  private elementUnder(hostX: number, hostY: number): Element | null {
    const rect = this.opts.iframe.getBoundingClientRect();
    const docX = hostX - rect.left;
    const docY = hostY - rect.top;
    if (docX < 0 || docY < 0 || docX > rect.width || docY > rect.height) return null;
    const doc = this.opts.iframe.contentDocument;
    return doc?.elementFromPoint(docX, docY) ?? null;
  }

  private dispatchClick(el: Element, hostX: number, hostY: number): void {
    const rect = this.opts.iframe.getBoundingClientRect();
    const init: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: hostX - rect.left,
      clientY: hostY - rect.top,
      view: this.opts.iframe.contentWindow ?? window,
    };
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
  }
}

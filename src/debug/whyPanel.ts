/**
 * Renders the "Why didn't it fire?" panel for the currently focused
 * gesture. The panel shows each condition the detector exposed, with a
 * pass/fail tick, so you can see *which* threshold is blocking activation
 * without instrumenting code.
 */

import type { GestureState } from '../config/types.js';

export class WhyPanel {
  private targetEl: HTMLElement;
  private listEl: HTMLElement;
  private current = 'pinch';

  constructor(root: HTMLElement) {
    const target = root.querySelector<HTMLElement>('#why-target');
    const list = root.querySelector<HTMLElement>('#why-list');
    if (!target || !list) throw new Error('whyPanel: missing #why-target or #why-list');
    this.targetEl = target;
    this.listEl = list;
  }

  setTarget(name: string): void {
    this.current = name;
  }

  update(states: Readonly<Record<string, GestureState>>): void {
    this.targetEl.textContent = this.current;
    const state = states[this.current];
    this.listEl.innerHTML = '';
    if (!state) return;

    const status = document.createElement('li');
    status.className = state.active ? 'pass' : 'fail';
    const sl = document.createElement('span'); sl.textContent = 'active';
    const sv = document.createElement('span'); sv.textContent = state.active ? 'YES' : 'no';
    status.append(sl, sv);
    this.listEl.appendChild(status);

    const conf = document.createElement('li');
    const cl = document.createElement('span'); cl.textContent = 'confidence';
    const cv = document.createElement('span'); cv.textContent = state.confidence.toFixed(2);
    conf.append(cl, cv);
    this.listEl.appendChild(conf);

    for (const c of state.conditions) {
      const li = document.createElement('li');
      li.className = c.passed ? 'pass' : 'fail';
      const a = document.createElement('span'); a.textContent = c.label;
      const b = document.createElement('span'); b.textContent = String(c.value);
      li.append(a, b);
      this.listEl.appendChild(li);
    }
  }
}

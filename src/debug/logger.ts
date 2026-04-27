/**
 * In-page log console. The whole app uses this instead of `console.log`
 * so logs stay visible while the user has the app full-screen, and so
 * they can be filtered by severity from the UI.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}

const MAX_ENTRIES = 200;

class Logger {
  private entries: LogEntry[] = [];
  private listEl: HTMLOListElement | null = null;
  private enabled: Record<LogLevel, boolean> = { debug: false, info: true, warn: true, error: true };
  private rateLimitMap = new Map<string, number>();

  attach(listEl: HTMLOListElement, toolbar: HTMLDivElement): void {
    this.listEl = listEl;
    toolbar.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      const level = cb.dataset.level as LogLevel | undefined;
      if (!level) return;
      cb.checked = this.enabled[level];
      cb.addEventListener('change', () => {
        this.enabled[level] = cb.checked;
        this.render();
      });
    });
    const clearBtn = toolbar.querySelector('#log-clear');
    clearBtn?.addEventListener('click', () => {
      this.entries = [];
      this.render();
    });
    this.render();
  }

  debug(msg: string): void { this.push('debug', msg); }
  info(msg: string): void { this.push('info', msg); }
  warn(msg: string): void { this.push('warn', msg); }
  error(msg: string): void { this.push('error', msg); }

  /** Like info, but only fires once per `key` per `windowMs`. */
  throttled(level: LogLevel, key: string, windowMs: number, msg: string): void {
    const last = this.rateLimitMap.get(key) ?? 0;
    const now = performance.now();
    if (now - last < windowMs) return;
    this.rateLimitMap.set(key, now);
    this.push(level, msg);
  }

  private push(level: LogLevel, msg: string): void {
    this.entries.push({ ts: Date.now(), level, msg });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    // Mirror to the dev tools console too.
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${level}] ${msg}`);
    this.render();
  }

  private render(): void {
    if (!this.listEl) return;
    // Cheap full-rebuild — fine for ≤200 lines.
    this.listEl.innerHTML = '';
    for (const e of this.entries) {
      if (!this.enabled[e.level]) continue;
      const li = document.createElement('li');
      li.className = e.level;
      const t = document.createElement('time');
      t.textContent = formatTime(e.ts);
      const m = document.createElement('span');
      m.textContent = e.msg;
      li.append(t, m);
      this.listEl.appendChild(li);
    }
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

export const logger = new Logger();

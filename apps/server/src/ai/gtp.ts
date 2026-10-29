import { BLACK, Game, PASS, Stone, handicapPoints } from '@igo/shared';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { Engine, EngineMove } from './engine.js';

/** An external engine that speaks GTP (Go Text Protocol) over stdin/stdout, e.g. KataGo or GNU Go. */
export interface GtpConfig {
  id: string;
  username: string;
  label: string;
  rank: string;
  command: string;
  args?: string[];
  cwd?: string;
  /** Give up on one genmove after this long and pass instead. Default 60 s. */
  timeoutMs?: number;
}

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

export function toVertex(p: number, size: number): string {
  if (p === PASS) return 'pass';
  return `${COLS[p % size]}${size - Math.floor(p / size)}`;
}

export function fromVertex(v: string, size: number): number | 'pass' | 'resign' | null {
  const s = v.trim().toUpperCase();
  if (s === 'PASS') return 'pass';
  if (s === 'RESIGN') return 'resign';
  const x = COLS.indexOf(s[0]);
  const row = Number(s.slice(1));
  if (x < 0 || x >= size || !Number.isInteger(row) || row < 1 || row > size) return null;
  return (size - row) * size + x;
}

export class GtpEngine implements Engine {
  readonly id: string;
  readonly username: string;
  readonly label: string;
  readonly rank: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private waiting: { resolve: (r: string) => void; reject: (e: Error) => void }[] = [];
  /** One conversation at a time: each request replays the whole game. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private cfg: GtpConfig) {
    this.id = cfg.id;
    this.username = cfg.username;
    this.label = cfg.label;
    this.rank = cfg.rank;
  }

  genMove(game: Game, color: Stone): Promise<EngineMove> {
    return this.serial(async () => {
      await this.load(game);
      const reply = await this.command(`genmove ${color === BLACK ? 'b' : 'w'}`, this.cfg.timeoutMs ?? 60_000);
      const v = fromVertex(reply, game.settings.size);
      if (v === 'pass' || v === null) return { type: 'pass' } as const;
      if (v === 'resign') return { type: 'resign' } as const;
      return { type: 'play', p: v } as const;
    });
  }

  deadStones(game: Game): Promise<number[]> {
    return this.serial(async () => {
      await this.load(game);
      const reply = await this.command('final_status_list dead', 30_000).catch(() => '');
      return reply
        .split(/\s+/)
        .map((v) => fromVertex(v, game.settings.size))
        .filter((p): p is number => typeof p === 'number');
    });
  }

  close() {
    this.proc?.kill();
    this.proc = null;
    for (const w of this.waiting.splice(0)) w.reject(new Error(`GTP engine ${this.id} closed`));
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Sets up the engine's board to match the game. */
  private async load(game: Game) {
    const { size, komi, handicap, ruleset } = game.settings;
    await this.command(`boardsize ${size}`);
    await this.command('clear_board');
    await this.command(`komi ${komi}`);
    // KataGo extension; other engines answer with an error, which is fine.
    await this.command(`kata-set-rules ${ruleset}`).catch(() => {});
    const hc = handicapPoints(size, handicap);
    if (hc.length) await this.command(`set_free_handicap ${hc.map(([x, y]) => toVertex(y * size + x, size)).join(' ')}`);
    for (const m of game.moves) await this.command(`play ${m.c === BLACK ? 'b' : 'w'} ${toVertex(m.p, size)}`);
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const proc = spawn(this.cfg.command, this.cfg.args ?? [], { cwd: this.cfg.cwd, stdio: 'pipe' });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d: string) => this.onData(d));
    proc.stderr.resume();
    const fail = (e: Error) => {
      if (this.proc !== proc) return;
      this.proc = null;
      for (const w of this.waiting.splice(0)) w.reject(e);
    };
    proc.on('error', fail);
    proc.on('exit', (code) => fail(new Error(`GTP engine ${this.id} exited (${code})`)));
    this.proc = proc;
    this.buf = '';
    return proc;
  }

  private onData(d: string) {
    this.buf += d.replace(/\r/g, '');
    // A GTP response ends with an empty line.
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const resp = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 2);
      const w = this.waiting.shift();
      if (!w) continue;
      if (resp.startsWith('=')) w.resolve(resp.slice(1).trim());
      else w.reject(new Error(`GTP error: ${resp.slice(1).trim()}`));
    }
  }

  private command(cmd: string, timeoutMs = 10_000): Promise<string> {
    const proc = this.start();
    return new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => {
        // The engine is out of step with us now: restart it on the next command.
        this.close();
        reject(new Error(`GTP timeout: ${cmd}`));
      }, timeoutMs);
      this.waiting.push({
        resolve: (r) => (clearTimeout(t), resolve(r)),
        reject: (e) => (clearTimeout(t), reject(e)),
      });
      proc.stdin.write(cmd + '\n');
    });
  }
}

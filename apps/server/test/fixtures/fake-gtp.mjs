// Minimal GTP engine for tests: plays the first empty point from the top-left, tracks nothing else.
import { createInterface } from 'node:readline';

const COLS = 'ABCDEFGHJKLMNOPQRST';
let size = 19;
let stones = new Set();
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [cmd, ...args] = line.trim().split(/\s+/);
  const ok = (s = '') => process.stdout.write(`= ${s}\n\n`);
  switch (cmd) {
    case 'boardsize': size = Number(args[0]); return ok();
    case 'clear_board': stones = new Set(); return ok();
    case 'komi': return ok();
    case 'set_free_handicap': args.forEach((v) => stones.add(v.toUpperCase())); return ok();
    case 'play': if (args[1].toLowerCase() !== 'pass') stones.add(args[1].toUpperCase()); return ok();
    case 'genmove':
      for (let row = size; row >= 1; row--)
        for (let x = 0; x < size; x++) {
          const v = `${COLS[x]}${row}`;
          if (!stones.has(v)) { stones.add(v); return ok(v); }
        }
      return ok('pass');
    case 'final_status_list': return ok('A1 B2');
    case 'quit': ok(); return process.exit(0);
    default: process.stdout.write(`? unknown command\n\n`);
  }
});

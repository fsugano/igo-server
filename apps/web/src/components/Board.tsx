import { BLACK, WHITE, handicapPoints } from '@igo/shared';
import { useMemo, useState } from 'react';

const COLS = 'ABCDEFGHJKLMNOPQRST';

export function pointName(p: number, size: number): string {
  if (p < 0) return 'パス';
  return `${COLS[p % size]}${size - Math.floor(p / size)}`;
}

/** Star points: the 9-stone handicap pattern for 13/19, 5 for 9x9. */
function starPoints(size: number): [number, number][] {
  if (size === 19 || size === 13) return handicapPoints(size, 9);
  if (size === 9) return handicapPoints(9, 5);
  return [];
}

interface Props {
  size: number;
  cells: number[];
  lastMove?: number | null;
  /** Colour of the ghost stone shown under the cursor; null disables clicks. */
  ghost?: number | null;
  onPlay?: (p: number) => void;
  dead?: number[];
  /** Territory ownership to draw (scoring). */
  ownership?: number[] | null;
}

export function Board({ size, cells, lastMove, ghost, onPlay, dead = [], ownership }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const deadSet = useMemo(() => new Set(dead), [dead]);
  const stars = useMemo(() => starPoints(size), [size]);
  const m = 1.1;
  const view = `${-m} ${-m} ${size - 1 + 2 * m} ${size - 1 + 2 * m}`;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(<line key={`h${i}`} x1={0} y1={i} x2={size - 1} y2={i} />);
    lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={size - 1} />);
  }
  const labels = [];
  for (let i = 0; i < size; i++) {
    labels.push(
      <text key={`t${i}`} x={i} y={-0.75}>{COLS[i]}</text>,
      <text key={`b${i}`} x={i} y={size - 1 + 0.85}>{COLS[i]}</text>,
      <text key={`l${i}`} x={-0.8} y={i + 0.05}>{size - i}</text>,
      <text key={`r${i}`} x={size - 1 + 0.8} y={i + 0.05}>{size - i}</text>,
    );
  }
  const stones = [];
  const marks = [];
  for (let p = 0; p < cells.length; p++) {
    const x = p % size;
    const y = Math.floor(p / size);
    const c = cells[p];
    if (c === BLACK || c === WHITE) {
      stones.push(
        <circle
          key={p}
          cx={x}
          cy={y}
          r={0.47}
          className={`stone ${c === BLACK ? 'black' : 'white'}${deadSet.has(p) ? ' dead' : ''}`}
        />,
      );
    }
    const own = ownership?.[p];
    if (own && (c === 0 || deadSet.has(p))) {
      marks.push(<rect key={`o${p}`} x={x - 0.17} y={y - 0.17} width={0.34} height={0.34} className={`terr ${own === BLACK ? 'black' : 'white'}`} />);
    }
  }
  if (lastMove != null && lastMove >= 0 && cells[lastMove]) {
    const x = lastMove % size;
    const y = Math.floor(lastMove / size);
    marks.push(<circle key="last" cx={x} cy={y} r={0.2} className={`last ${cells[lastMove] === BLACK ? 'on-black' : 'on-white'}`} />);
  }
  const ghostStone =
    ghost && hover !== null && cells[hover] === 0 ? (
      <circle cx={hover % size} cy={Math.floor(hover / size)} r={0.47} className={`stone ghost ${ghost === BLACK ? 'black' : 'white'}`} />
    ) : null;

  const pointFromEvent = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const { x, y } = pt.matrixTransform(ctm.inverse());
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= size || iy >= size) return null;
    return iy * size + ix;
  };

  return (
    <svg
      className={`board${onPlay ? ' interactive' : ''}`}
      viewBox={view}
      onPointerMove={(e) => setHover(pointFromEvent(e))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const p = pointFromEvent(e as unknown as React.PointerEvent<SVGSVGElement>);
        if (p !== null && onPlay) onPlay(p);
      }}
      role="img"
      aria-label="碁盤"
    >
      <defs>
        <radialGradient id="gb" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#666" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </radialGradient>
        <radialGradient id="gw" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cfcac0" />
        </radialGradient>
      </defs>
      <rect x={-m} y={-m} width={size - 1 + 2 * m} height={size - 1 + 2 * m} className="wood" />
      <g className="grid">{lines}</g>
      <g className="stars">
        {stars.map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={0.1} />
        ))}
      </g>
      <g className="coords">{labels}</g>
      <g>{stones}</g>
      {ghostStone}
      <g>{marks}</g>
    </svg>
  );
}

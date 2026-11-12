import {
  GameView,
  GaugeState,
  NARRATION_LANGS,
  NarrationLang,
  NarrationNames,
  GameSnapshot,
  narrateEval,
  narrateIntro,
  narrateUpdate,
} from '@igo/shared';
import { useEffect, useRef } from 'react';
import { Narrator, speechUnsupported } from '../narrator';

export type NarrationChoice = NarrationLang | 'off';

/**
 * Reads each move aloud, plus the gauge's comments when a gauge is given.
 * Only for spectators and the recording mode: players never get it (see narration.ts in @igo/shared).
 */
export function useNarration(opts: {
  view: GameView | null;
  names: NarrationNames | null;
  gauge: GaugeState | null;
  lang: NarrationChoice;
}) {
  const { view, names, gauge, lang } = opts;
  const narrator = useRef<Narrator | null>(null);
  narrator.current ??= new Narrator();
  const prev = useRef<GameSnapshot | null>(null);
  const prevEval = useRef<number>(-1);
  const namesRef = useRef(names);
  namesRef.current = names;

  // Turning it on (or switching language) introduces the game; turning it off stops at once.
  useEffect(() => {
    const n = narrator.current!;
    n.stop();
    if (lang === 'off' || !view || !names) return;
    n.lang = lang;
    if (view.state.phase !== 'finished') n.say([narrateIntro(lang, names, view.state.settings)]);
  }, [lang, view?.id, !!names]);

  useEffect(() => () => narrator.current?.stop(), []);

  useEffect(() => {
    if (!view) return;
    const before = prev.current;
    prev.current = view.state;
    if (lang === 'off' || !namesRef.current || !before) return;
    narrator.current!.say(narrateUpdate(lang, before, view.state, namesRef.current));
  }, [view, lang]);

  useEffect(() => {
    const evals = gauge?.evals ?? [];
    const cur = evals.at(-1);
    if (!cur) return;
    const last = prevEval.current;
    prevEval.current = cur.moveNumber;
    if (lang === 'off' || !namesRef.current || last < 0 || cur.moveNumber <= last || gauge?.final) return;
    const before = [...evals].reverse().find((e) => e.moveNumber <= last);
    const line = narrateEval(lang, before, cur);
    if (line) narrator.current!.say([line]);
  }, [gauge, lang]);

  return {
    /** Reads the introduction again (e.g. when a recording starts). */
    intro: () => {
      if (lang === 'off' || !view || !names) return;
      narrator.current!.stop();
      narrator.current!.say([narrateIntro(lang, names, view.state.settings)]);
    },
  };
}

export function NarrationSelect({ value, onChange }: { value: NarrationChoice; onChange: (v: NarrationChoice) => void }) {
  if (speechUnsupported()) return null;
  return (
    <label className="narration-select">
      音声実況
      <select value={value} onChange={(e) => onChange(e.target.value as NarrationChoice)}>
        <option value="off">オフ</option>
        {NARRATION_LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const KEY = 'igo.narration';

/** The spectator's choice, remembered in this browser. */
export function loadNarrationChoice(): NarrationChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'ja' || v === 'en' ? v : 'off';
  } catch {
    return 'off';
  }
}

export function saveNarrationChoice(v: NarrationChoice) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

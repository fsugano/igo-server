/** Reads commentary aloud with the browser's own speech synthesis (no server, no cost). */
import { NARRATION_LANGS, NarrationLang, NarrationLine } from '@igo/shared';

export const speechUnsupported = () => typeof window === 'undefined' || !('speechSynthesis' in window);

/** The best voice for a language: a natural or online voice when the browser has one. */
export function pickVoice(lang: NarrationLang): SpeechSynthesisVoice | null {
  if (speechUnsupported()) return null;
  const want = NARRATION_LANGS.find((l) => l.id === lang)!.voiceLang;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith(want.slice(0, 2)));
  const exact = voices.filter((v) => v.lang.replace('_', '-') === want);
  const pool = exact.length ? exact : voices;
  const score = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 2 : 0) + (/google/i.test(v.name) ? 1 : 0);
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * A queue of lines. When moves come faster than they can be read (games between engines),
 * move lines still waiting are dropped so the commentary keeps up with the board; other lines are kept.
 */
export class Narrator {
  private queue: NarrationLine[] = [];
  private speaking = false;
  private current: SpeechSynthesisUtterance | null = null;
  lang: NarrationLang = 'ja';
  rate = 1.1;

  say(lines: NarrationLine[]) {
    if (speechUnsupported() || !lines.length) return;
    if (lines.some((l) => l.kind === 'move')) this.queue = this.queue.filter((l) => l.kind !== 'move');
    this.queue.push(...lines);
    this.next();
  }

  stop() {
    this.queue = [];
    this.speaking = false;
    this.current = null;
    if (!speechUnsupported()) speechSynthesis.cancel();
  }

  private next() {
    if (this.speaking) return;
    const line = this.queue.shift();
    if (!line) return;
    const u = new SpeechSynthesisUtterance(line.text);
    const voice = pickVoice(this.lang);
    if (voice) u.voice = voice;
    u.lang = NARRATION_LANGS.find((l) => l.id === this.lang)!.voiceLang;
    u.rate = this.rate;
    // Some browsers occasionally never fire onend: do not let the queue stall.
    const guard = setTimeout(() => done(), 4000 + line.text.length * 250);
    const done = () => {
      clearTimeout(guard);
      if (this.current !== u) return;
      this.current = null;
      this.speaking = false;
      this.next();
    };
    this.current = u;
    u.onend = done;
    u.onerror = done;
    this.speaking = true;
    speechSynthesis.speak(u);
  }
}

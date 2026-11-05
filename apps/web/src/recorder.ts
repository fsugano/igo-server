/**
 * Recording with the browser's own features, no extra software.
 * Method A ("tab"): share this tab, crop the video to the broadcast stage, and save it with MediaRecorder.
 */

export interface RecordingOptions {
  fps: 30 | 60;
  /** Target height of the video, e.g. 1080. */
  height: 1080 | 720;
}

export interface Recording {
  /** True if the video is cropped to the stage. Without it, the whole tab is recorded. */
  cropped: boolean;
  mimeType: string;
  /** Stops recording and returns the video. */
  stop(): Promise<Blob>;
  /** Called if the recording ends from outside (e.g. the browser's "stop sharing" button). */
  onEnded?: () => void;
}

interface CropTargetStatic {
  fromElement(el: Element): Promise<unknown>;
}
type CroppableTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> };

const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

/** Why tab recording cannot run in this browser, or null if it can. */
export function tabRecordingUnsupported(): string | null {
  if (typeof MediaRecorder === 'undefined') return 'このブラウザは録画（MediaRecorder）に対応していません';
  if (!navigator.mediaDevices?.getDisplayMedia) return 'このブラウザは画面の収録（getDisplayMedia）に対応していません';
  if (!MIME_TYPES.some((t) => MediaRecorder.isTypeSupported(t))) return 'このブラウザで保存できる動画の形式がありません';
  return null;
}

/** True if the video can be cropped to an element (Region Capture, Chrome and Edge). */
export const canCrop = () => 'CropTarget' in window;

export async function startTabRecording(stage: HTMLElement, opts: RecordingOptions): Promise<Recording> {
  const width = Math.round((opts.height * 16) / 9);
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: opts.fps }, width: { ideal: width }, height: { ideal: opts.height } },
    // The tab's own sound: the stone clicks.
    audio: true,
    // Chrome: offer this tab first in the picker.
    preferCurrentTab: true,
  } as DisplayMediaStreamOptions);

  const track = stream.getVideoTracks()[0] as CroppableTrack;
  let cropped = false;
  const CropTarget = (window as unknown as { CropTarget?: CropTargetStatic }).CropTarget;
  if (CropTarget && track.cropTo) {
    try {
      await track.cropTo(await CropTarget.fromElement(stage));
      cropped = true;
    } catch {
      // Another tab or window was chosen: it cannot be cropped to our element.
    }
  }

  const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t))!;
  const rec = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: opts.height === 1080 ? (opts.fps === 60 ? 12_000_000 : 8_000_000) : 5_000_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
    };
  });

  const recording: Recording = {
    cropped,
    mimeType,
    stop: async () => {
      if (rec.state !== 'inactive') rec.stop();
      return done;
    },
  };
  track.addEventListener('ended', () => {
    if (rec.state !== 'inactive') rec.stop();
    recording.onEnded?.();
  });
  rec.start(1000);
  return recording;
}

/** Offers the video as a download. */
export function saveVideo(blob: Blob, name: string) {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${ext}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

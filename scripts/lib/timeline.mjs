/**
 * Shared 30 FPS scene timing used by populate and voiceover placement.
 */
export const FPS = 30;
export const OVERLAP_FRAMES = 12;

export function framesToSeconds(frames) {
  const seconds = frames / FPS;
  if (Number.isInteger(seconds)) return seconds;
  return Number(seconds.toFixed(10));
}

export function framesToSecondsAttr(frames) {
  return String(framesToSeconds(frames));
}

/**
 * @param {Array<{ duration: number }>} scenes
 * @returns {{ type?: string, durationFrames: number, startFrames: number, scene: object }[]}
 */
export function computeSceneTimeline(scenes) {
  let cursor = 0;
  const timed = scenes.map((scene, index, all) => {
    const startFrames = cursor;
    const isLast = index === all.length - 1;
    cursor += scene.duration - (isLast ? 0 : OVERLAP_FRAMES);
    return {
      index,
      type: scene.type,
      durationFrames: scene.duration,
      startFrames,
      scene,
    };
  });
  const last = timed[timed.length - 1];
  const totalFrames = last.startFrames + last.durationFrames;
  return { timed, totalFrames, totalSeconds: framesToSeconds(totalFrames) };
}

/* GENERATED — DO NOT EDIT.
 *
 * The audio façade, stubbed out, written by Fiwo/Tools/build_web_study.mjs.
 *
 * The website ships NO audio. Not an oversight and not a missing feature: the
 * only Fiwo voice that exists today is eSpeak, and the project's position is
 * that a robotic voice teaching a language to a dyslexic learner who studies by
 * ear is worse than silence. Audio lands when the trained Piper voice does.
 *
 * This exists so `study.js` — vendored unchanged from the app — resolves its
 * import. Every answer is "no", which is what makes the speaker button absent
 * rather than present and silent.
 */
export const BACKEND = { OFF: 'off', ESPEAK: 'espeak', PIPER: 'piper' };

export function isEnabled() { return false; }
export function shouldAutoplay() { return false; }
export async function speak() { /* nothing to say, yet */ }
export function unlockAudio() {}
export function configure() {}

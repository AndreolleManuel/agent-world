import { describe, expect, it } from 'vitest';
import { ambientCues, bubblePosition, type AmbientActor } from './ambience';

const actors: AmbientActor[] = [
  { id: 'worker', phase: 'live_run', interaction: 'typing-at-desk' },
  { id: 'reader', phase: 'available', interaction: 'reading-in-lounge' },
  { id: 'offline', phase: 'telemetry_unavailable', interaction: 'typing-at-desk' },
  { id: 'review', phase: 'review_pending', interaction: 'thinking-at-board' },
  { id: 'blocked', phase: 'blocked', interaction: 'blocked-at-board' },
];

describe('decorative agent chatter', () => {
  it('takes turns between work and rest, never inventing activity for other states', () => {
    const seen = new Set<string>();
    for (let time = 0; time < 90_000; time += 200) {
      const cues = ambientCues(actors, time);
      expect(cues.length).toBeLessThanOrEqual(2);
      expect(new Set(cues.map((cue) => cue.id)).size).toBe(cues.length);
      cues.forEach((cue) => {
        expect(['worker', 'reader']).toContain(cue.id);
        expect(cue.alpha).toBeGreaterThanOrEqual(0);
        expect(cue.alpha).toBeLessThanOrEqual(1);
        seen.add(cue.id);
      });
    }
    expect([...seen].sort()).toEqual(['reader', 'worker']);
    expect(ambientCues([], 10_000)).toEqual([]);
  });

  it('survives reordered refreshes, rotates messages and leaves pauses for a lone agent', () => {
    expect(ambientCues(actors, 5500)).toEqual(ambientCues([...actors].reverse(), 5500));
    const messages = new Set<string>();
    let quiet = 0;
    for (let time = 1000; time < 65_000; time += 1000) {
      const cues = ambientCues([actors[0]], time);
      expect(cues.length).toBeLessThanOrEqual(1);
      if (!cues.length) quiet++;
      cues.forEach((cue) => messages.add(cue.text));
    }
    expect(messages.size).toBeGreaterThan(3);
    expect(quiet).toBeGreaterThan(0);
  });

  it('keeps bubbles inside the canvas and avoids labels and other bubbles', () => {
    const first = bubblePosition(6, 30, 1280, 720, [])!;
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(first.y).toBeGreaterThanOrEqual(0);
    const last = bubblePosition(1275, 718, 1280, 720, [])!;
    expect(last.x + last.width).toBeLessThan(1280);
    expect(last.y + last.height).toBeLessThan(720);
    expect(bubblePosition(6, 30, 1280, 720, [{ x: 0, y: 0, width: 1280, height: 720 }])).toBeNull();
  });
  it('offers forty different messages in every context before starting a new lap', () => {
    const contexts: AmbientActor[] = [
      { id: 'solo', phase: 'live_run', interaction: 'typing-at-desk' },
      { id: 'solo', phase: 'available', interaction: 'sitting-on-sofa' },
      { id: 'solo', phase: 'available', interaction: 'drinking-coffee' },
      { id: 'solo', phase: 'available', interaction: 'reading-in-lounge' },
      { id: 'solo', phase: 'available', interaction: 'playing-handheld' },
    ];
    const all = new Set<string>();
    for (const actor of contexts) {
      const messages = Array.from({ length: 40 }, (_, round) => ambientCues([actor], 1000 + round * 8400)[0].text);
      expect(new Set(messages).size).toBe(40);
      for (const message of messages) {
        expect(message.split('\n').length).toBeLessThanOrEqual(3);
        all.add(message);
      }
      expect(ambientCues([actor], 1000 + 40 * 8400)[0].text).toBe(messages[0]);
    }
    expect(all.size).toBe(200);
  });

});

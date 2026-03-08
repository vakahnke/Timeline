export const RULER_HEIGHT  = 38;
export const TRACK_HEIGHT  = 64;
export const MIN_PX_PER_HR = 4;
export const MAX_PX_PER_HR = 8000;

export const PALETTE = [
  '#4a88ff', '#ff6b4a', '#4aff9e', '#ffd84a', '#c44aff',
  '#ff4aaa', '#4adcff', '#ffaa4a', '#aaff4a', '#ff4a4a',
  '#4affdd', '#ff8c4a', '#7a4aff', '#4affa0', '#ff4a70',
];

export const TICK_INTERVALS = [
  { ms: 60_000,      fmt: 'time' },
  { ms: 300_000,     fmt: 'time' },
  { ms: 900_000,     fmt: 'time' },
  { ms: 1_800_000,   fmt: 'time' },
  { ms: 3_600_000,   fmt: 'time' },
  { ms: 7_200_000,   fmt: 'time' },
  { ms: 14_400_000,  fmt: 'hour' },
  { ms: 28_800_000,  fmt: 'hour' },
  { ms: 86_400_000,  fmt: 'date' },
  { ms: 604_800_000, fmt: 'date' },
];

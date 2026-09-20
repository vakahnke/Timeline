import brand from '../brand.json'

// The product's name, everywhere a person sees it in the app. It lives in ../brand.json so the
// build can put the same name in index.html. Someone hosting their own copy can set
// VITE_APP_NAME at build time instead of editing the file.
export const BRAND = import.meta.env.VITE_APP_NAME || brand.name

export const RULER_HEIGHT  = 38;
export const TRACK_HEIGHT  = 80;   // row height; tall enough that above/below name labels of adjacent rows don't collide (48px bar + 2×12px labels + clearance)
// Low floor so multi-month / multi-year projects can be zoomed out to fit the whole span.
export const MIN_PX_PER_HR = 0.02;
export const MAX_PX_PER_HR = 8000;

export const PALETTE = [
  '#4a88ff', '#ff6b4a', '#4aff9e', '#ffd84a', '#c44aff',
  '#ff4aaa', '#4adcff', '#ffaa4a', '#aaff4a', '#ff4a4a',
  '#4affdd', '#ff8c4a', '#7a4aff', '#4affa0', '#ff4a70',
];

export const TICK_INTERVALS = [
  { ms: 60_000,         fmt: 'time' },   // 1 min
  { ms: 300_000,        fmt: 'time' },   // 5 min
  { ms: 900_000,        fmt: 'time' },   // 15 min
  { ms: 1_800_000,      fmt: 'time' },   // 30 min
  { ms: 3_600_000,      fmt: 'time' },   // 1 hr
  { ms: 7_200_000,      fmt: 'time' },   // 2 hr
  { ms: 14_400_000,     fmt: 'hour' },   // 4 hr
  { ms: 28_800_000,     fmt: 'hour' },   // 8 hr
  { ms: 86_400_000,     fmt: 'date' },   // 1 day
  { ms: 604_800_000,    fmt: 'date' },   // 1 week
  { ms: 2_592_000_000,  fmt: 'month' },  // ~1 month
  { ms: 7_776_000_000,  fmt: 'month' },  // ~1 quarter
  { ms: 31_536_000_000, fmt: 'year' },   // ~1 year
];

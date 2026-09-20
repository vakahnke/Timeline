// Words and small sums for the template library. No React in here, so it is easy to test.

const DAY = 1440

export const GROUPS = [
  { id: 'business', label: 'Business' },
  { id: 'work',     label: 'Work' },
  { id: 'hobby',    label: 'Hobby' },
  { id: 'other',    label: 'Other' },
]

export const VISIBILITY_LABEL = {
  private:  'Private',
  teams:    'Shared with teams',
  instance: 'Everyone here',
}

// "3 days", "6 weeks", "14 months": how long the plan is.
export function spanText(minutes) {
  const days = minutes / DAY
  if (days < 1) return `${Math.max(1, Math.round(minutes / 60))} hours`
  if (days < 21) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
  if (days < 120) return `${Math.round(days / 7)} weeks`
  return `${Math.round(days / 30)} months`
}

// "typically runs 6% long" / "about on plan" / "12% short". Null until enough runs have finished.
export function ratioText(ratio) {
  if (ratio == null) return null
  const pct = Math.round((ratio - 1) * 100)
  if (Math.abs(pct) < 3) return 'typically runs about on plan'
  return `typically runs ${Math.abs(pct)}% ${pct > 0 ? 'long' : 'short'}`
}

// One line for a card. Says nothing at all until somebody has used the plan.
export function recordLine(rec) {
  if (!rec || !rec.started) return null
  const parts = [`Started ${rec.started}`, `finished ${rec.finished}`]
  const ratio = ratioText(rec.typical_ratio)
  if (ratio) parts.push(ratio)
  return parts.join(' · ')
}

// What an author should look at twice before sharing: addresses, @names, phone numbers, links.
const SUSPECT = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'an email address'],
  [/(^|\s)@[a-z0-9_.-]{2,}/i, 'an @name'],
  [/(\+?\d[\d\s().-]{8,}\d)/, 'a phone number'],
  [/https?:\/\/\S+/i, 'a link'],
]
export function suspectIn(text) {
  const hit = SUSPECT.find(([re]) => re.test(text || ''))
  return hit ? hit[1] : null
}

// Every piece of text other people would get, in the order of the plan.
export function sharedText(template, { notes = true, todos = true } = {}) {
  const rows = []
  const add = (kind, where, text) => { if ((text || '').trim()) rows.push({ kind, where, text, flag: suspectIn(text) }) }
  add('Name', '', template.name)
  add('One-line summary', '', template.summary)
  add('Description', '', template.description)
  for (const c of template.categories || []) add('Track', '', c.name)
  for (const t of template.tasks || []) {
    add('Event', t.category, t.title)
    if (notes) add('Note', t.title, t.notes)
    if (todos) for (const todo of t.todos || []) add('To-do', t.title, todo.title)
  }
  return rows
}

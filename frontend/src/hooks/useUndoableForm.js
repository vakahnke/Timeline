import { useReducer, useCallback } from 'react'

// Undo/redo for a single form-state object. `set` records history; consecutive edits to
// the SAME field with { coalesce: true } collapse into one undo step (so typing a run of
// characters or dragging a slider is one step), while discrete changes (e.g. toggling a
// checkbox) each get their own step.
function reducer(s, a) {
  switch (a.type) {
    case 'set': {
      const next = typeof a.value === 'function' ? a.value(s.value) : a.value
      if (next === s.value) return s
      const coalesce = a.coalesce && a.field && s.lastField === a.field && s.past.length > 0
      return {
        value: next,
        past: coalesce ? s.past : [...s.past, s.value],
        future: [],
        lastField: a.field ?? null,
      }
    }
    case 'undo':
      if (!s.past.length) return s
      return { value: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.value, ...s.future], lastField: null }
    case 'redo':
      if (!s.future.length) return s
      return { value: s.future[0], past: [...s.past, s.value], future: s.future.slice(1), lastField: null }
    case 'reset':
      return { value: a.value, past: [], future: [], lastField: null }
    default:
      return s
  }
}

export function useUndoableForm(initial) {
  const [state, dispatch] = useReducer(reducer, { value: initial, past: [], future: [], lastField: null })
  const set   = useCallback((value, opts = {}) => dispatch({ type: 'set', value, ...opts }), [])
  const reset = useCallback((value) => dispatch({ type: 'reset', value }), [])
  const undo  = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo  = useCallback(() => dispatch({ type: 'redo' }), [])
  return {
    value: state.value,
    set, reset, undo, redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}

import { useEffect, useState } from 'react'

// True on phone-width viewports. Matches the CSS breakpoint in style.css (max-width: 640px)
// so JS layout decisions (e.g. docking the dashboard windows) and CSS stay in step.
const QUERY = '(max-width: 640px)'

// Pass a different media query to reuse the hook for other breakpoints (e.g. the timeline's
// compact header rail, which also applies to a phone held in landscape).
export default function useIsNarrow(query = QUERY) {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const onChange = (e) => setNarrow(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return narrow
}

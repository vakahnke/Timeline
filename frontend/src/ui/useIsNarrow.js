import { useEffect, useState } from 'react'

// True on phone-width viewports. Matches the CSS breakpoint in style.css (max-width: 640px)
// so JS layout decisions (e.g. docking the dashboard windows) and CSS stay in step.
const QUERY = '(max-width: 640px)'

export default function useIsNarrow() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches)

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(QUERY)
    const onChange = (e) => setNarrow(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return narrow
}

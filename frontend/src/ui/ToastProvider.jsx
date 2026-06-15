import { createContext, useContext, useCallback, useRef, useState } from 'react'

const ToastContext = createContext(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }) {
  const [status, setStatus] = useState(null)  // { msg, type }
  const timer = useRef(null)

  // Mirrors the prototype's `flash`: a transient status pill.
  const flash = useCallback((msg, type) => {
    clearTimeout(timer.current)
    setStatus({ msg, type })
    if (type !== 'saving') timer.current = setTimeout(() => setStatus(null), 2500)
  }, [])

  return (
    <ToastContext.Provider value={{ status, flash }}>
      {children}
      {status && <div className={`toast ${status.type}`}>{status.msg}</div>}
    </ToastContext.Provider>
  )
}

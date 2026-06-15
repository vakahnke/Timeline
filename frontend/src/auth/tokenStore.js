// Single source of truth for token persistence. Swapping localStorage for an
// HttpOnly-cookie scheme later means editing only this module.
const ACCESS_KEY  = 'tl.access'
const REFRESH_KEY = 'tl.refresh'

export const tokens = {
  get access()  { return localStorage.getItem(ACCESS_KEY) },
  get refresh() { return localStorage.getItem(REFRESH_KEY) },

  set({ access, refresh }) {
    if (access)  localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },

  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

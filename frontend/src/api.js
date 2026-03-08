const BASE = '/api';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  list:   ()      => req('/events/'),
  create: (data)  => req('/events/',        { method: 'POST',  body: JSON.stringify(data) }),
  update: (id, d) => req(`/events/${id}/`,  { method: 'PATCH', body: JSON.stringify(d) }),
  remove: (id)    => req(`/events/${id}/`,  { method: 'DELETE' }),

  categories: {
    list:   ()         => req('/categories/'),
    create: (data)     => req('/categories/',       { method: 'POST',  body: JSON.stringify(data) }),
    update: (id, data) => req(`/categories/${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id)       => req(`/categories/${id}/`, { method: 'DELETE' }),
  },
};

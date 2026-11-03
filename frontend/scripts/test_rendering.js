// Renders the real App (server-side, through Vite) at every content route and checks the right content appears.
// Run from frontend/: npm run check:render. No backend needed: live data loads in effects, which don't run here.
import { createServer } from 'vite'
import React from 'react'
import ReactDOMServer from 'react-dom/server'

// React Router's links use useLayoutEffect, which React warns about when rendering on a server. The site is
// rendered in the browser, so the warning doesn't apply here; hide just that one.
const consoleError = console.error
console.error = (msg, ...rest) => (typeof msg === 'string' && msg.includes('useLayoutEffect does nothing on the server') ? undefined : consoleError(msg, ...rest))

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let failures = 0

try {
  const { MemoryRouter } = await server.ssrLoadModule('react-router-dom')
  const { AuthProvider } = await server.ssrLoadModule('./src/context/auth.jsx')
  const { default: App } = await server.ssrLoadModule('./src/App.jsx')
  const { pastEvents } = await server.ssrLoadModule('./src/data/events.js')
  const { departments, institutionalBackbone, leadership, lifecycleStages, industryVoices } = await server.ssrLoadModule('./src/data/site.js')

  const render = (path) =>
    ReactDOMServer.renderToString(
      React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(AuthProvider, null, React.createElement(App))),
    )
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
  function expect(path, mustContain, mustNotContain = []) {
    const html = render(path)
    const missing = mustContain.filter((s) => !html.includes(escape(s)) && !html.includes(s))
    const unwanted = mustNotContain.filter((s) => html.includes(s))
    if (missing.length || unwanted.length) {
      failures++
      console.log(`FAIL  ${path}${missing.length ? `  missing: ${missing.join(' | ')}` : ''}${unwanted.length ? `  unexpected: ${unwanted.join(' | ')}` : ''}`)
    } else {
      console.log(`PASS  ${path} (${html.length} bytes)`)
    }
  }

  const { allEvents } = await server.ssrLoadModule('./src/data/events.js')
  const { club } = await server.ssrLoadModule('./src/data/site.js')
  const linked = lifecycleStages.flatMap((s) => s.events ?? [])
  const unknown = linked.filter((slug) => !allEvents.some((e) => e.slug === slug))
  if (unknown.length) {
    failures++
    console.log(`FAIL  lifecycleStages link to unknown events: ${unknown.join(', ')}`)
  }
  expect('/', [
    'From ideas to',
    'Our Vision in Action',
    ...lifecycleStages.map((s) => s.stage),
    ...linked.map((slug) => `/events/${slug}`),
    ...industryVoices.filter((v) => v.photo && v.linkedin).map((v) => v.name),
    'Partner with us',
    club.email,
  ], [
    'Next event',
    'Documented Events in Archive',
    // The section stays hidden until at least one speaker has both a photo and a LinkedIn link
    ...(industryVoices.some((v) => v.photo && v.linkedin) ? [] : ['Voices from the stage']),
  ])
  {
    // The events strip sits directly under the hero, before Vision in Action
    const html = render('/')
    if (html.indexOf('Recent events') > html.indexOf('Our Vision in Action')) {
      failures++
      console.log('FAIL  / the events strip should come before Our Vision in Action')
    }
  }
  expect('/events/past', ['Events', ...pastEvents.map((e) => e.name)])
  expect('/events/upcoming', ['Upcoming', 'Loading events'])
  for (const e of pastEvents) expect(`/events/${e.slug}`, [e.name, 'About'], ['Page not found'])
  for (const e of pastEvents.filter((x) => x.aliases?.length)) expect(`/events/${e.aliases[0]}`, [e.name], ['Page not found'])
  expect('/about', [
    institutionalBackbone.founder.name,
    institutionalBackbone.coordinator.name,
    ...leadership.map((l) => l.name),
    ...departments.map((d) => d.name),
    'Our journey',
  ])
  for (const d of departments) expect(`/teams/${d.id}`, [d.name, ...d.heads.map((h) => h.name), ...(d.work ?? []).map((w) => w.title)])
  expect('/teams/not-a-wing', ['Page not found'])
  expect('/events/not-an-event', ['Page not found'])
  expect('/does-not-exist', ['Page not found'])
  // The password pages are gone: their old links render no reset form
  for (const path of ['/signup', '/forgot-password', '/reset-password?token=abc']) expect(path, [], ['Reset your password', 'Choose a new password', 'Create account'])
  // Before the session check finishes, auth pages and protected pages show a loading state rather than a redirect
  expect('/profile', ['Loading'])
  console.log(`\nLifecycle stages available: ${lifecycleStages.length}`)
} catch (err) {
  failures++
  console.error(err)
} finally {
  await server.close()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll routes rendered with their content.')
process.exit(failures ? 1 : 0)

// LAN-Modus am echten Server (freie lokale Ports, Skript-Gehirne, kein Netz nach aussen):
// Standard bindet nur lokal, Beitritt mit/ohne Code, Drosselung, jeder Platz sieht nur seine Sicht,
// fremdes Token handelt nicht fuer andere, Frist, Wiederverbinden, Uebergabe an die KI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { erstelleServer, lanAusStart } from '../server.mjs'
import { skriptGehirn } from '../tools/skriptgehirne.mjs'

const fabrik = (name, rolle, { zufall: z }) => skriptGehirn(name, rolle, z)
const LAN = { adresse: '127.0.0.1', port: 0 }   // im Test: zweiter Port auf Loopback statt WLAN-Adresse

async function lanServer(opts = {}) {
  const s = erstelleServer({ gehirnFabrik: fabrik, port: 0, pause: 0, startwert: 11, log: () => {}, lan: { ...LAN, frist: 5000, raten: 1000, ...opts.lan }, ...opts.server })
  const lokal = await s.starten()
  return { s, lokal, gast: s.lan().port, code: s.lan().code }
}
const anfrage = (port, pfad, { methode = 'GET', body, token, kopf = {} } = {}) => fetch(`http://127.0.0.1:${port}${pfad}`, {
  method: methode,
  headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-nachsitzen-token': token } : {}), ...kopf },
  body: body !== undefined ? JSON.stringify(body) : undefined,
}).then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {} return { status: r.status, text: t, body: j } })
const beitreten = (port, code, name) => anfrage(port, '/lan/beitreten', { methode: 'POST', body: { code, name } })

// SSE eines Platzes mitlesen; `auf` darf auf jede Nachricht reagieren. Liefert Nachrichten und Rohtext.
async function strom(port, token, bis, { auf = async () => {}, zeit = 10000 } = {}) {
  const ac = new AbortController()
  const wecker = setTimeout(() => ac.abort(), zeit)
  const r = await fetch(`http://127.0.0.1:${port}/lan/ereignisse?token=${encodeURIComponent(token)}`, { signal: ac.signal })
  const nachrichten = []; let roh = '', rest = ''
  if (r.status !== 200) { clearTimeout(wecker); return { status: r.status, nachrichten, roh: await r.text() } }
  const leser = r.body.getReader(); const dec = new TextDecoder()
  try {
    for (;;) {
      const { value, done } = await leser.read(); if (done) break
      const t = dec.decode(value, { stream: true }); roh += t; rest += t
      let i
      while ((i = rest.indexOf('\n\n')) >= 0) {
        const block = rest.slice(0, i); rest = rest.slice(i + 2)
        const art = /^event: (.+)$/m.exec(block)?.[1]; if (!art) continue
        const n = { art, daten: JSON.parse(/^data: (.*)$/m.exec(block)[1]) }
        nachrichten.push(n); await auf(n)
      }
      if (bis(nachrichten)) break
    }
  } catch (f) { if (f.name !== 'AbortError') throw f } finally { clearTimeout(wecker); ac.abort() }
  return { status: r.status, nachrichten, roh }
}
const istEnde = (l) => l.some((n) => n.art === 'status' && n.daten?.phase === 'ende')

// Einfache Antwort auf jede Frage
function antwortAuf(w) {
  switch (w.art) {
    case 'sagen': return w.pflicht ? { art: 'sagt', text: 'Ich stand bei der Tür.' } : { art: 'schweigt' }
    case 'nacht': return { platz: w.orte[0], ziel: w.optionen[0] }
    case 'untersuchen': return { ort: null }
    case 'zeigen': return { zeigen: false }
    case 'stimme': return { fuer: null }
    default: return {}
  }
}
const spielt = (port, token) => async (n) => {
  const w = n.art === 'warte' ? n.daten : null
  if (w) await anfrage(port, '/lan/aktion', { methode: 'POST', body: antwortAuf(w), token })
}

test('LAN: ohne Schalter bindet der Server nur lokal und kennt keine /lan-Routen', async () => {
  const s = erstelleServer({ gehirnFabrik: fabrik, port: 0, pause: 0 })
  const port = await s.starten()
  try {
    assert.equal(s.server.address().address, '127.0.0.1')
    assert.equal(s.lan(), null)
    assert.equal((await anfrage(port, '/lan/lobby')).status, 404)
    assert.equal((await beitreten(port, 'ABCDEF', 'Ada')).status, 404)
  } finally { await s.schliessen() }
  assert.equal(lanAusStart(['node', 'server.mjs'], {}), null)
  assert.deepEqual(lanAusStart(['node', 'server.mjs', '--lan'], {}), { adresse: undefined })
  assert.deepEqual(lanAusStart(['node', 'server.mjs'], { NACHSITZEN_LAN: '1', NACHSITZEN_LAN_ADRESSE: '192.168.1.5' }), { adresse: '192.168.1.5' })
})

test('LAN: ueber die LAN-Adresse nur Seite und /lan, nichts Lokales; Gastgeber-Routen nur am Rechner', async () => {
  const { s, lokal, gast, code } = await lanServer()
  try {
    assert.notEqual(lokal, gast)
    assert.equal((await anfrage(gast, '/')).status, 200)
    assert.equal((await anfrage(gast, '/app.js')).status, 200)
    for (const pfad of ['/status', '/verlauf', '/hefte', '/figuren', '/ereignisse']) assert.equal((await anfrage(gast, pfad)).status, 404, pfad)
    assert.equal((await anfrage(gast, '/partie', { methode: 'POST', body: { name: 'X' } })).status, 405)
    assert.equal((await anfrage(gast, '/lan/start', { methode: 'POST', body: {} })).status, 404)
    assert.equal((await anfrage(gast, '/lan/uebergeben', { methode: 'POST', body: { name: 'Ada' } })).status, 404)
    // Gaeste sehen die Lobby nur mit Token, und nie den Code
    assert.equal((await anfrage(gast, '/lan/lobby')).status, 403)
    const a = await beitreten(gast, code, 'Ada')
    const l = await anfrage(gast, '/lan/lobby', { token: a.body.token })
    assert.equal(l.status, 200); assert.equal(l.body.ich, 'Ada'); assert.ok(!l.text.includes(code)); assert.ok(!l.text.includes(a.body.token))
    // Gastgeber am Rechner sieht Code und Adresse
    const g = await anfrage(lokal, '/lan/lobby')
    assert.equal(g.body.code, code); assert.match(g.body.adresse, /^http:\/\/127\.0\.0\.1:\d+\/\?lan=1$/)
    // Fremder Host-Kopf an der LAN-Adresse (DNS-Rebinding)
    const fremd = await new Promise((f) => http.get({ host: '127.0.0.1', port: gast, path: '/', headers: { host: 'boese.example' } }, (r) => f(r.statusCode)))
    assert.equal(fremd, 403)
    // Gastgeber-Routen pruefen die Herkunft
    assert.equal((await anfrage(lokal, '/lan/start', { methode: 'POST', body: {}, kopf: { origin: 'http://boese.example' } })).status, 403)
    // Nur JSON
    const r = await fetch(`http://127.0.0.1:${gast}/lan/beitreten`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ code, name: 'Bo' }) })
    assert.equal(r.status, 415)
  } finally { await s.schliessen() }
})

test('LAN: Beitritt mit/ohne Code, Drosselung, hoechstens 4, nach dem Start zu', async () => {
  const { s, lokal, gast, code } = await lanServer()
  try {
    assert.equal((await beitreten(gast, '', 'Ada')).status, 403)
    assert.equal((await beitreten(gast, 'ZZZZZZ', 'Ada')).status, 403)
    const a = await beitreten(gast, code.toLowerCase(), 'Ada')
    assert.equal(a.status, 200); assert.equal(a.body.name, 'Ada'); assert.ok(a.body.token.length >= 43)
    assert.equal((await anfrage(lokal, '/lan/beitreten', { methode: 'POST', body: { name: 'Gastgeber' } })).status, 200, 'am Rechner ohne Code')
    await beitreten(gast, code, 'Bo'); await beitreten(gast, code, 'Cy')
    const voll = await beitreten(gast, code, 'Dee')
    assert.equal(voll.status, 409); assert.match(voll.body.fehler, /4 Menschen/)
    // Drosselung: nach 5 Fehlversuchen (zusammen mit den 2 oben) ist auch der richtige Code gesperrt
    for (let i = 0; i < 3; i++) assert.equal((await beitreten(gast, 'FALSCH', 'Eve')).status, 403)
    const gesperrt = await beitreten(gast, code, 'Eve')
    assert.equal(gesperrt.status, 429)
  } finally { await s.schliessen() }
})

test('LAN: zwei Plaetze sehen nur ihre Sicht, fremdes Token handelt nicht fuer andere', async () => {
  const { s, lokal, gast, code } = await lanServer()
  try {
    const a = (await beitreten(gast, code, 'Ada')).body, b = (await beitreten(gast, code, 'Bo')).body
    // Start erst, wenn alle bereit sind
    assert.match((await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })).body.fehler, /nicht bereit/)
    for (const t of [a.token, b.token]) assert.equal((await anfrage(gast, '/lan/bereit', { methode: 'POST', body: { bereit: true }, token: t })).status, 200)
    // Ohne Token oder mit falschem Token: nichts
    assert.equal((await anfrage(gast, '/lan/aktion', { methode: 'POST', body: { art: 'schweigt' } })).status, 403)
    assert.equal((await anfrage(gast, '/lan/aktion', { methode: 'POST', body: { art: 'schweigt' }, token: 'x'.repeat(43) })).status, 403)
    assert.equal((await anfrage(gast, `/lan/verlauf?token=${'y'.repeat(43)}`)).status, 403)
    // Token per Query zaehlt bei POST nicht
    assert.equal((await anfrage(gast, `/lan/aktion?token=${a.token}`, { methode: 'POST', body: { art: 'schweigt' } })).status, 403)

    const fremdeVersuche = []
    const laeufe = Promise.all([
      strom(gast, a.token, istEnde, { auf: async (n) => {
        // Ada versucht, mit ihrem Token Bos offene Frage zu beantworten: geht nur fuer ihren eigenen Platz
        if (n.art === 'warte' && n.daten) fremdeVersuche.push(n.daten.art)
        await spielt(gast, a.token)(n)
      } }),
      strom(gast, b.token, istEnde, { auf: spielt(gast, b.token) }),
    ])
    await new Promise((f) => setTimeout(f, 50))
    assert.equal((await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })).status, 200)
    assert.equal((await beitreten(gast, code, 'Spaet')).status, 409, 'nach dem Start kein Beitritt')
    const [sa, sb] = await laeufe
    const p = s.partie()
    assert.equal(p.phase, 'ende')
    assert.deepEqual(p.menschen, ['Ada', 'Bo'])
    for (const [ich, du, st] of [['Ada', 'Bo', sa], ['Bo', 'Ada', sb]]) {
      const ereignisse = st.nachrichten.filter((n) => n.art === 'ereignis').map((n) => n.daten)
      const vorEnde = st.nachrichten.filter((n) => n.art === 'status' && n.daten && n.daten.phase !== 'ende').map((n) => n.daten)
      assert.ok(ereignisse.some((e) => e.art === 'rolle' && e.name === ich), `${ich} kennt die eigene Rolle`)
      assert.ok(!ereignisse.some((e) => e.art === 'rolle' && e.name !== ich), `${ich} sieht keine fremde Rolle`)
      const privat = ['platz', 'schatten-waehlt', 'pruefung', 'petze-prueft', 'beobachtung', 'ergebnis']
      assert.ok(!ereignisse.some((e) => privat.includes(e.art) && e.wer !== ich), `${ich} sieht keine fremden Nacht-Ereignisse`)
      assert.ok(vorEnde.every((x) => x.spieler === ich && x.rollen === null && x.rolle === p.rollen[ich]), 'Status nur mit eigener Rolle')
      assert.ok(!st.roh.includes('"sichtbar"'), 'Sichtbarkeitsliste geht nicht hinaus')
      // Rohtext: vor dem Ende taucht die Rolle des anderen nirgends als Rollenereignis auf
      const bisEnde = st.roh.slice(0, st.roh.indexOf('"phase":"ende"'))
      assert.ok(!bisEnde.includes(`"art":"rolle","name":"${du}"`))
      // warte-Nachrichten kamen nur fuer den eigenen Platz: jede eigene Frage wurde beantwortet
      assert.ok(st.nachrichten.some((n) => n.art === 'warte' && n.daten))
    }
    assert.ok(fremdeVersuche.length > 0)
    // Nach dem Ende: Rollen fuer alle sichtbar, Lobby wieder offen mit neuem Code
    const ende = await anfrage(gast, '/lan/verlauf', { token: a.token })
    assert.ok(ende.body.status.rollen)
    assert.equal((await anfrage(lokal, '/lan/lobby')).body.offen, true)
  } finally { await s.schliessen() }
})

test('LAN: fremdes Token kann nicht fuer einen anderen Platz antworten', async () => {
  const { s, lokal, gast, code } = await lanServer()
  try {
    const a = (await beitreten(gast, code, 'Ada')).body, b = (await beitreten(gast, code, 'Bo')).body
    for (const t of [a.token, b.token]) await anfrage(gast, '/lan/bereit', { methode: 'POST', body: {}, token: t })
    let geprueft = false
    const laeufe = Promise.all([
      strom(gast, a.token, (l) => istEnde(l) || geprueft, { auf: spielt(gast, a.token) }),
      strom(gast, b.token, (l) => istEnde(l) || geprueft, { auf: async (n) => {
        if (n.art === 'warte' && n.daten && !geprueft) {
          // Bo ist gefragt. Adas Token beantwortet nur Adas Frage; ist sie gerade nicht gefragt: Fehler, Bo wartet weiter
          const versuch = await anfrage(gast, '/lan/aktion', { methode: 'POST', body: antwortAuf(n.daten), token: a.token })
          const st = await anfrage(gast, '/lan/verlauf', { token: b.token })
          if (versuch.status === 400) { assert.ok(st.body.status.warte, 'Bos Frage ist noch offen'); geprueft = true }
        }
        await spielt(gast, b.token)(n)
      } }),
    ])
    await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })
    await laeufe
    assert.ok(geprueft, 'mindestens einmal war nur Bo gefragt')
  } finally { await s.schliessen() }
})

test('LAN: Frist – ohne Eingaben laeuft die Partie trotzdem bis zum Ende (enthaelt sich)', async () => {
  const { s, lokal, gast, code } = await lanServer({ lan: { frist: 30 } })
  try {
    const a = (await beitreten(gast, code, 'Ada')).body
    await anfrage(gast, '/lan/bereit', { methode: 'POST', body: { bereit: true }, token: a.token })
    const lauf = strom(gast, a.token, istEnde)
    await new Promise((f) => setTimeout(f, 30))
    await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })
    const st = await lauf
    assert.ok(istEnde(st.nachrichten))
    assert.ok(st.nachrichten.some((n) => n.art === 'frist'), 'Hinweis, dass die Zeit um ist')
    assert.ok(st.nachrichten.some((n) => n.art === 'warte' && n.daten?.frist === 0), 'Frist steht in der Frage')
    assert.ok(s.partie().ereignisse.some((e) => e.art === 'sagt' && e.von === 'Ada' && e.text === '…'), 'Pflichtsatz am Abend als …')
  } finally { await s.schliessen() }
})

test('LAN: Wiederverbinden mit demselben Token liefert Rolle und offene Frage', async () => {
  const { s, lokal, gast, code } = await lanServer({ lan: { frist: 60_000 } })
  try {
    const a = (await beitreten(gast, code, 'Ada')).body
    await anfrage(gast, '/lan/bereit', { methode: 'POST', body: { bereit: true }, token: a.token })
    await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })
    // erste Verbindung kurz, dann weg
    await strom(gast, a.token, (l) => l.some((n) => n.art === 'status' && n.daten?.warte))
    // warten, bis Ada gefragt ist (Abend), dann neu verbinden
    const zweite = await strom(gast, a.token, (l) => l.some((n) => n.art === 'status' && n.daten?.warte))
    const st = zweite.nachrichten.find((n) => n.art === 'status' && n.daten?.warte).daten
    assert.equal(st.spieler, 'Ada'); assert.equal(st.rolle, s.partie().rollen.Ada); assert.equal(st.warte.art, 'sagen')
    assert.ok(zweite.nachrichten.some((n) => n.art === 'ereignis' && n.daten.art === 'rolle' && n.daten.name === 'Ada'), 'Verlauf wird nachgeliefert')
    // Antwort nach dem Wiederverbinden zaehlt
    assert.equal((await anfrage(gast, '/lan/aktion', { methode: 'POST', body: { art: 'sagt', text: 'Bin wieder da.' }, token: a.token })).status, 200)
    assert.ok(s.partie().ereignisse.some((e) => e.art === 'sagt' && e.text === 'Bin wieder da.'))
  } finally { await s.schliessen() }
})

test('LAN: Gastgeber uebergibt einen Platz an die KI; das alte Token gilt nicht mehr', async () => {
  const { s, lokal, gast, code } = await lanServer({ lan: { frist: 60_000 } })
  try {
    const a = (await beitreten(gast, code, 'Ada')).body, b = (await beitreten(gast, code, 'Bo')).body
    for (const t of [a.token, b.token]) await anfrage(gast, '/lan/bereit', { methode: 'POST', body: { bereit: true }, token: t })
    const bo = strom(gast, b.token, (l) => l.some((n) => n.art === 'uebergeben'))
    const ada = strom(gast, a.token, istEnde, { auf: spielt(gast, a.token), zeit: 15000 })
    await new Promise((f) => setTimeout(f, 30))
    await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })
    // Bo antwortet nie; der Gastgeber gibt den Platz an die KI
    await new Promise((f) => setTimeout(f, 100))
    const u = await anfrage(lokal, '/lan/uebergeben', { methode: 'POST', body: { name: 'Bo' } })
    assert.equal(u.status, 200); assert.equal(u.body.lobby, false)
    assert.ok((await bo).nachrichten.some((n) => n.art === 'uebergeben'))
    assert.equal((await anfrage(gast, '/lan/aktion', { methode: 'POST', body: { art: 'schweigt' }, token: b.token })).status, 403)
    const st = await ada
    assert.ok(istEnde(st.nachrichten), 'Partie laeuft ohne Bo bis zum Ende')
    const letzter = st.nachrichten.filter((n) => n.art === 'status' && n.daten).at(-1).daten
    assert.deepEqual(letzter.lan.menschen, ['Ada'])
    assert.equal((await anfrage(lokal, '/lan/uebergeben', { methode: 'POST', body: { name: 'Niemand' } })).status, 404)
  } finally { await s.schliessen() }
})

test('LAN: Rechner des Gastgebers ohne Platz sieht nur Oeffentliches; Einzelpartie bleibt fuer LAN-Geraete unsichtbar', async () => {
  const { s, lokal, gast, code } = await lanServer({ lan: { frist: 20 } })
  try {
    const a = (await beitreten(gast, code, 'Ada')).body
    await anfrage(gast, '/lan/bereit', { methode: 'POST', body: {}, token: a.token })
    await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })
    for (let i = 0; i < 200 && s.partie().phase !== 'ende'; i++) await new Promise((f) => setTimeout(f, 20))
    const v = await anfrage(lokal, '/verlauf')
    assert.ok(!v.body.ereignisse.some((e) => ['rolle', 'platz', 'schatten-waehlt', 'pruefung', 'beobachtung', 'ergebnis'].includes(e.art)))
    assert.equal(v.body.status.spieler, null)
    // Einzelpartie am Rechner: Ada sieht davon nichts
    await anfrage(lokal, '/partie', { methode: 'POST', body: { name: 'Stefan' } })
    const sicht = await anfrage(gast, '/lan/verlauf', { token: a.token })
    assert.equal(sicht.body.status, null); assert.deepEqual(sicht.body.ereignisse, [])
  } finally { await s.schliessen() }
})

test('LAN: Ratenlimit und Groessenlimit je Platz', async () => {
  const { s, gast, code } = await lanServer({ lan: { raten: 30 } })
  try {
    const a = (await beitreten(gast, code, 'Ada')).body
    let gedrosselt = false
    for (let i = 0; i < 40 && !gedrosselt; i++) gedrosselt = (await anfrage(gast, '/lan/lobby', { token: a.token })).status === 429
    assert.ok(gedrosselt)
    const r = await anfrage(gast, '/lan/beitreten', { methode: 'POST', body: { code, name: 'x'.repeat(3000) } })
    assert.equal(r.status, 413)
  } finally { await s.schliessen() }
})

test('LAN: zweite Runde – neuer Code, Plaetze bleiben, Lobby waehrend der Partie zu', async () => {
  const { s, lokal, gast, code } = await lanServer({ lan: { frist: 20 } })
  try {
    const a = (await beitreten(gast, code, 'Ada')).body
    const runde = async () => {
      await anfrage(gast, '/lan/bereit', { methode: 'POST', body: { bereit: true }, token: a.token })
      assert.equal((await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })).status, 200)
      assert.equal((await anfrage(lokal, '/lan/lobby')).body.offen, false, 'Lobby zu, solange die Partie laeuft')
      for (let i = 0; i < 300 && s.partie().phase !== 'ende'; i++) await new Promise((f) => setTimeout(f, 20))
      for (let i = 0; i < 50 && !(await anfrage(lokal, '/lan/lobby')).body.offen; i++) await new Promise((f) => setTimeout(f, 20))
    }
    await runde()
    const zweiterCode = (await anfrage(lokal, '/lan/lobby')).body.code
    assert.equal(s.lan().code, zweiterCode)
    assert.equal((await anfrage(gast, '/lan/lobby', { token: a.token })).body.plaetze[0].bereit, false, 'nach der Partie wieder nicht bereit')
    await runde()
    assert.equal(s.partie().phase, 'ende')
  } finally { await s.schliessen() }
})

test('LAN: oeffentliche oder Wildcard-Adresse wird abgelehnt', async () => {
  for (const adresse of ['0.0.0.0', '8.8.8.8']) {
    const s = erstelleServer({ gehirnFabrik: fabrik, port: 0, pause: 0, log: () => {}, lan: { adresse, port: 0 } })
    await assert.rejects(s.starten(), /keine private WLAN-Adresse/)
  }
})

test('LAN: nach dem Ende bekommen die Geraete die wieder offene Lobby; Stream zaehlt nicht zur Drossel', async () => {
  const { s, lokal, gast, code } = await lanServer({ lan: { frist: 20, raten: 5 } })
  try {
    const a = (await beitreten(gast, code, 'Ada')).body
    await anfrage(gast, '/lan/bereit', { methode: 'POST', body: { bereit: true }, token: a.token })
    // viele Stream-Aufbauten hintereinander: keiner wird mit 429 abgewiesen
    for (let i = 0; i < 6; i++) assert.equal((await strom(gast, a.token, () => true)).status, 200)
    const lauf = strom(gast, a.token, (l) => istEnde(l) && l.some((n) => n.art === 'lobby' && n.daten.offen && !n.daten.laeuft && l.indexOf(n) > 2))
    await new Promise((f) => setTimeout(f, 30))
    await anfrage(lokal, '/lan/start', { methode: 'POST', body: {} })
    const st = await lauf
    const letzte = st.nachrichten.filter((n) => n.art === 'lobby').at(-1).daten
    assert.equal(letzte.offen, true); assert.equal(letzte.laeuft, false)
  } finally { await s.schliessen() }
})

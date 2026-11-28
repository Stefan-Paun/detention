import { test } from 'node:test'
import assert from 'node:assert/strict'
import { erstelleServer } from '../server.mjs'
import { skriptGehirn } from '../spiel/skriptgehirne.mjs'
import { TEMPO, tempoMs, tempoAktion, mitBremse, wartePause, istTempoAktion } from '../spiel/tempo.mjs'
import { lokalerSpielleiter } from '../public/lokal.js'

const schlafe = (ms) => new Promise((f) => setTimeout(f, ms))

test('Tempo: Werte, Pruefung der Aktion, nur beim Zuschauen', () => {
  assert.equal(tempoMs(700, 'langsam'), 1400); assert.equal(tempoMs(700, 'normal'), 700); assert.equal(tempoMs(700, 'schnell'), 150)
  assert.equal(tempoMs(700, 'unsinn'), 700)
  assert.deepEqual(Object.keys(TEMPO), ['langsam', 'normal', 'schnell'])
  const sp = { zuschauen: true, tempo: 'normal', pausiert: false }
  assert.equal(tempoAktion(sp, { art: 'tempo', wert: 'schnell' }), null); assert.equal(sp.tempo, 'schnell')
  assert.match(tempoAktion(sp, { art: 'tempo', wert: 'turbo' }), /langsam, normal, schnell/); assert.equal(sp.tempo, 'schnell')
  assert.match(tempoAktion(sp, { art: 'tempo', wert: 'toString' }), /Tempo/)
  assert.equal(tempoAktion(sp, { art: 'pause', wert: true }), null); assert.equal(sp.pausiert, true)
  assert.match(tempoAktion(sp, { art: 'pause', wert: 'ja' }), /true oder false/); assert.equal(sp.pausiert, true)
  assert.match(tempoAktion({ zuschauen: false }, { art: 'pause', wert: true }), /nur beim Zuschauen/)
  assert.match(tempoAktion(null, { art: 'pause', wert: true }), /Keine laufende Partie/)
  assert.ok(istTempoAktion({ art: 'tempo' }) && istTempoAktion({ art: 'pause' }) && !istTempoAktion({ art: 'sagt' }) && !istTempoAktion(null))
})

test('Tempo: mitBremse startet keinen Aufruf, solange pausiert ist, und bricht nach dem Ende ab', async () => {
  const sp = { pausiert: true, beendet: false }
  let aufrufe = 0
  const g = mitBremse({ diskussion: () => { aufrufe++; return { art: 'schweigt' } }, merkePruefung: () => 'unveraendert' }, sp)
  assert.equal(g.merkePruefung(), 'unveraendert')
  assert.equal(g.untersuchen, undefined, 'fehlende Methoden bleiben fehlend')
  const laeuft = g.diskussion()
  await schlafe(250)
  assert.equal(aufrufe, 0, 'waehrend der Pause kein Aufruf')
  sp.pausiert = false
  assert.deepEqual(await laeuft, { art: 'schweigt' }); assert.equal(aufrufe, 1)
  sp.pausiert = true
  const abgebrochen = g.diskussion()
  sp.beendet = true
  await assert.rejects(abgebrochen, /abgebrochen/)
  assert.equal(aufrufe, 1)
  await wartePause({ pausiert: true, beendet: true })   // kehrt sofort zurueck
})

const post = (port, body) => fetch(`http://127.0.0.1:${port}/aktion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }))
const status = (port) => fetch(`http://127.0.0.1:${port}/status`).then((r) => r.json())
const anzahl = (port) => fetch(`http://127.0.0.1:${port}/verlauf`).then((r) => r.json()).then((d) => d.ereignisse.length)

test('Server: Pause haelt die Zuschauer-Partie an (keine Ereignisse, keine Gehirn-Aufrufe), Tempo steht im Status', async () => {
  let aufrufe = 0
  const zaehlend = (name, rolle, { zufall: z }) => {
    const g = skriptGehirn(name, rolle, z)
    for (const m of ['abend', 'nacht', 'diskussion', 'abstimmung', 'untersuchen', 'zeigen']) if (g[m]) { const f = g[m]; g[m] = (...a) => { aufrufe++; return f(...a) } }
    return g
  }
  const s = erstelleServer({ gehirnFabrik: zaehlend, port: 0, pause: 5, startwert: 3, log: () => {} })
  const port = await s.starten()
  try {
    const start = await (await fetch(`http://127.0.0.1:${port}/partie`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zuschauen: true }) })).json()
    assert.equal(start.tempo, 'normal'); assert.equal(start.pausiert, false)
    await schlafe(30)
    const an = await post(port, { art: 'pause', wert: true })
    assert.equal(an.status, 200); assert.equal(an.body.pausiert, true)
    assert.equal((await status(port)).pausiert, true)
    await schlafe(150)   // ein Schritt, der schon lief, darf noch fertig werden
    const n = await anzahl(port), a = aufrufe
    assert.notEqual(s.partie().phase, 'ende', 'Startwert und Wartezeit lassen die Partie nicht vor der Pause enden')
    await schlafe(400)
    assert.equal(await anzahl(port), n, 'keine neuen Ereignisse waehrend der Pause')
    assert.equal(aufrufe, a, 'keine neuen Gehirn-Aufrufe waehrend der Pause')

    const t = await post(port, { art: 'tempo', wert: 'schnell' })
    assert.equal(t.status, 200); assert.equal((await status(port)).tempo, 'schnell')
    assert.equal((await post(port, { art: 'tempo', wert: 'turbo' })).status, 400)
    assert.equal((await post(port, { art: 'pause', wert: 'ja' })).status, 400)

    assert.equal((await post(port, { art: 'pause', wert: false })).status, 200)
    for (let i = 0; i < 100 && (await anzahl(port)) === n; i++) await schlafe(10)
    assert.ok((await anzahl(port)) > n, 'nach „weiter“ geht es weiter')
    assert.ok(aufrufe > a)
  } finally { await s.schliessen() }
})

test('Server: Tempo und Pause im Mitspielmodus abgelehnt (400), eine neue Partie loest eine pausierte ab', async () => {
  const fabrik = (name, rolle, { zufall: z }) => skriptGehirn(name, rolle, z)
  const s = erstelleServer({ gehirnFabrik: fabrik, port: 0, pause: 5, startwert: 3, log: () => {} })
  const port = await s.starten()
  const neu = (body) => fetch(`http://127.0.0.1:${port}/partie`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
  try {
    assert.equal((await post(port, { art: 'pause', wert: true })).status, 400, 'ohne Partie')
    await neu({ zuschauen: true })
    assert.equal((await post(port, { art: 'pause', wert: true })).status, 200)
    const alt = s.partie()
    const st = await neu({ name: 'Kim' })
    assert.equal(st.pausiert, false); assert.equal(st.tempo, 'normal')
    assert.notEqual(s.partie(), alt)
    const r = await post(port, { art: 'pause', wert: true })
    assert.equal(r.status, 400); assert.match(r.body.fehler, /nur beim Zuschauen/)
    assert.equal((await post(port, { art: 'tempo', wert: 'langsam' })).status, 400)
    assert.equal((await status(port)).tempo, 'normal')
  } finally { await s.schliessen() }
})

test('Demo: der lokale Spielleiter kennt Tempo und Pause wie der Server', async () => {
  const l = lokalerSpielleiter({ pause: 5, denkzeit: [0, 0], startwert: 3 })
  const meldungen = []
  l.an('ereignis', (e) => meldungen.push(e))
  l.partie({ zuschauen: true })
  assert.equal(l.status().tempo, 'normal')
  await schlafe(20)
  assert.ok(l.aktion({ art: 'pause', wert: true }).ok)
  await schlafe(100)
  const n = meldungen.length
  await schlafe(250)
  assert.equal(meldungen.length, n, 'angehalten')
  assert.ok(l.aktion({ art: 'tempo', wert: 'schnell' }).ok); assert.equal(l.status().tempo, 'schnell')
  assert.ok(l.aktion({ art: 'pause', wert: false }).ok)
  await l.lauf()
  assert.equal(l.status().phase, 'ende')
  l.partie({ name: 'Kim' })
  assert.equal(l.aktion({ art: 'pause', wert: true }).ok, false)
  l.beenden()
})

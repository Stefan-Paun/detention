// Browser-Demo ohne Server (public/lokal.js), Skript-Figuren als Detektive (#9), Seitenbau fuer Pages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zufall } from '../spiel/zufall.mjs'
import { skriptGehirn, widersprueche } from '../spiel/skriptgehirne.mjs'
import { statistik } from '../tools/simuliere.mjs'
import { AUSSEHEN } from '../spiel/demofiguren.mjs'
import { lokalerSpielleiter } from '../public/lokal.js'
import { baueSeite, browserModule, importeVon } from '../tools/seite.mjs'
import { erstelleServer } from '../server.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// B hat A nachts bei den Pulten gesehen, A behauptet am Morgen das Fenster
const sicht = [
  { nr: 0, nacht: 1, art: 'nacht', text: '' },
  { nr: 1, nacht: 1, art: 'platz', wer: 'B', ort: 'Tafel' },
  { nr: 2, nacht: 1, art: 'beobachtung', wer: 'B', typ: 'gesehen', name: 'A', ort: 'Pulte', text: 'Du hast gesehen: A stand bei den Pulten.' },
  { nr: 3, nacht: 1, art: 'sagt', von: 'A', an: null, text: 'Ich war am Fenster, die ganze Nacht.', behauptet: 'Fenster' },
]

test('Skript-Figur: Widerspruch zwischen Behauptung und Beobachtung wird genau so angeklagt', () => {
  assert.deepEqual(widersprueche(sicht, 'B'), [{ name: 'A', behauptet: 'Fenster', war: 'Pulte' }])
  const b = skriptGehirn('B', 'schueler', zufall(1))
  b.nacht(sicht, ['A', 'B', 'C'], { orte: ['Tür', 'Tafel', 'Pulte', 'Fenster'] })
  const a = b.diskussion(sicht, ['A', 'B', 'C'])
  assert.equal(a.art, 'sagt'); assert.equal(a.an, 'A')
  assert.match(a.text, /am Fenster/); assert.match(a.text, /bei den Pulten/)
  assert.equal(b.abstimmung(sicht, ['A', 'B', 'C']).fuer, 'A')
  // Kein zweites Mal derselbe Vorwurf in derselben Nacht
  for (let i = 0; i < 5; i++) { const x = b.diskussion(sicht, ['A', 'B', 'C']); assert.ok(!(x.an === 'A' && /passt nicht/.test(x.text ?? ''))) }
})

test('Skript-Figur gibt echte Beobachtungen weiter, der Skript-Schatten luegt nicht immer „Tür“', () => {
  const saetze = []
  for (let s = 1; s <= 40; s++) {
    const b = skriptGehirn('B', 'schueler', zufall(s))
    b.nacht(sicht.slice(0, 3), ['A', 'B', 'C'], { orte: ['Tafel'] })
    for (let i = 0; i < 3; i++) saetze.push(b.diskussion(sicht.slice(0, 3), ['A', 'B', 'C']).text ?? '')
  }
  assert.ok(saetze.some((t) => t === 'Ich weiß sicher: A stand heute Nacht bei den Pulten.'), 'Beobachtung weitergegeben')
  assert.ok(saetze.some((t) => t.startsWith('Ich war an der Tafel')), 'eigener Platz genannt')
  const luegen = new Set()
  for (let s = 1; s <= 200; s++) {
    const x = skriptGehirn('X', 'schatten', zufall(s))
    x.nacht([{ nacht: 1, art: 'nacht' }], ['X', 'A', 'B'], { orte: ['Pulte'], ziele: ['A', 'B'] })
    for (let i = 0; i < 4; i++) { const m = /^Ich war (.+), die ganze Nacht\.$/.exec(x.diskussion([{ nacht: 1, art: 'nacht' }], ['X', 'A', 'B']).text ?? ''); if (m && m[1] !== 'bei den Pulten') luegen.add(m[1]) }
  }
  assert.ok(luegen.size >= 2, `Luegen-Plaetze: ${[...luegen].join(', ')}`)
})

test('Balance mit Detektiv-Skripten: 200 Partien, Schueler 35-65 %, hoechstens 5 Naechte', async () => {
  const st = await statistik(200, 1)
  const q = st.schueler / st.partien
  assert.ok(q >= 0.35 && q <= 0.65, `Schueler-Quote ${q}`)
  assert.ok(st.laengste <= 5, `laengste Partie ${st.laengste}`)
})

test('Demo-Aussehen passt zu figuren/*.json', () => {
  for (const [n, look] of Object.entries(AUSSEHEN)) {
    const f = JSON.parse(fs.readFileSync(path.join(WURZEL, 'figuren', `${n.toLowerCase()}.json`), 'utf8'))
    assert.deepEqual(look, f.aussehen, n)
  }
})

// Netz verboten: jeder Versuch faellt auf
function ohneNetz() {
  const alt = { fetch: globalThis.fetch, EventSource: globalThis.EventSource }
  const versuche = []
  globalThis.fetch = (...a) => { versuche.push(['fetch', String(a[0])]); throw new Error('fetch in der Demo') }
  globalThis.EventSource = class { constructor(u) { versuche.push(['EventSource', u]); throw new Error('EventSource in der Demo') } }
  return { versuche, zurueck: () => Object.assign(globalThis, alt) }
}

test('Demo: 200 Zuschauer-Partien enden im Browser-Spielleiter, ohne ein einziges fetch/EventSource', async () => {
  const netz = ohneNetz()
  try {
    for (let s = 1; s <= 200; s++) {
      const l = lokalerSpielleiter({ pause: 0, denkzeit: [0, 0], startwert: s })
      let ereignisse = 0, letzter = null
      l.an('ereignis', () => ereignisse++); l.an('status', (st) => { letzter = st })
      l.partie({ zuschauen: true })
      await l.lauf()
      assert.equal(letzter.phase, 'ende', `Partie ${s}`)
      assert.ok(['schueler', 'schatten'].includes(letzter.sieger))
      assert.ok(ereignisse > 10)
      assert.ok(letzter.rollen && letzter.demo)
    }
  } finally { netz.zurueck() }
  assert.deepEqual(netz.versuche, [])
})

// Ein Mensch, der jede Frage mit einer gueltigen Wahl beantwortet (wie ein Klick im Browser)
function klicker(l, z) {
  const offene = []
  l.an('warte', (w) => { if (w) offene.push(w) })
  return async () => {
    while (offene.length) {
      const w = offene.shift()
      await null
      let a
      if (w.art === 'sagen') a = { art: 'sagt', text: z.aus(['Ich war am Fenster, die ganze Nacht.', 'Wer war bei der Tür?', 'Ich stand bei den Pulten.']), an: z.zahl() < 0.5 ? z.aus(w.andere) : null }
      else if (w.art === 'nacht') a = { platz: z.aus(w.orte), ziel: w.aufgabe === 'verstecken' ? undefined : z.aus(w.optionen) }
      else if (w.art === 'untersuchen') a = { ort: z.zahl() < 0.7 ? z.aus(w.orte) : null }
      else if (w.art === 'zeigen') a = { zeigen: z.zahl() < 0.5 }
      else a = { fuer: z.aus(w.optionen) }
      const r = l.aktion(a)
      assert.ok(r.ok, `${w.art}: ${r.fehler}`)
    }
  }
}

test('Demo: Partien mit Eingabe enden, falsche Eingaben bekommen eine Meldung', async () => {
  const netz = ohneNetz()
  try {
    for (let s = 1; s <= 30; s++) {
      const l = lokalerSpielleiter({ pause: 0, denkzeit: [0, 0], startwert: s })
      const z = zufall(1000 + s)
      const antworte = klicker(l, z)
      let letzter = null
      l.an('status', (st) => { letzter = st })
      const st = l.partie({ name: 'Alex' })
      assert.equal(st.spieler, 'Alex'); assert.ok(st.rolle)
      if (s === 1) { await new Promise((f) => setTimeout(f, 5)); assert.equal(l.aktion({ art: 'sagt', text: '' }).ok, false) }
      for (let i = 0; i < 2000 && letzter?.phase !== 'ende'; i++) { await antworte(); await new Promise((f) => setTimeout(f, 0)) }
      assert.equal(letzter.phase, 'ende', `Partie ${s}`)
    }
    assert.throws(() => lokalerSpielleiter().partie({ name: 'Klassenbuch' }), /schon belegt/)
  } finally { netz.zurueck() }
  assert.deepEqual(netz.versuche, [])
})

test('Seite fuer Pages: nur Browser-Module, kein node:, alle Importe innerhalb der Seite, Pfade relativ', () => {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-seite-'))
  try {
    const dateien = baueSeite(ziel)
    assert.ok(dateien.includes('index.html') && dateien.includes('lokal.js') && dateien.includes('spiel/skriptgehirne.mjs'))
    for (const verboten of ['spiel/gehirn.mjs', 'spiel/claude.mjs', 'spiel/schluessel.mjs', 'spiel/hefte.mjs', 'spiel/kosten.mjs', 'server.mjs']) assert.ok(!dateien.includes(verboten), verboten)
    for (const f of dateien.filter((f) => /\.m?js$/.test(f))) {
      const text = fs.readFileSync(path.join(ziel, f), 'utf8')
      assert.ok(!/['"]node:/.test(text), `${f} enthaelt node:`)
      for (const i of importeVon(text)) {
        assert.ok(i.startsWith('./') || i.startsWith('../'), `${f}: ${i}`)
        const voll = path.resolve(path.dirname(path.join(ziel, f)), i)
        assert.ok(voll.startsWith(ziel + path.sep) && fs.existsSync(voll), `${f}: ${i} fehlt in der Seite`)
      }
    }
    const html = fs.readFileSync(path.join(ziel, 'index.html'), 'utf8')
    for (const [, u] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(!u.startsWith('/'), `absoluter Pfad ${u}`)
  } finally { fs.rmSync(ziel, { recursive: true, force: true }) }
  assert.ok(browserModule().every((m) => m.startsWith('spiel/')))
})

test('app.js: Demo ohne Netz, Impressum/Datenschutz nur auf stefanpaun.page', () => {
  const app = fs.readFileSync(path.join(WURZEL, 'public', 'app.js'), 'utf8')
  assert.match(app, /if \(DEMO\) \{ const d = leiter/)
  assert.match(app, /if \(!DEMO\) fetch\('\/status'\)/)
  assert.match(app, /stefanpaun\\\.page\$/)
  const html = fs.readFileSync(path.join(WURZEL, 'public', 'index.html'), 'utf8')
  assert.match(html, /id="recht" hidden/)
  assert.match(html, /Demo mit Skript-Figuren/)
})

test('Server liefert die Browser-Module aus spiel/, aber nichts sonst daraus', async () => {
  const s = erstelleServer({ gehirnFabrik: (n, r, { zufall: z }) => skriptGehirn(n, r, z), port: 0, log: () => {} })
  const port = await s.starten()
  try {
    const a = await fetch(`http://127.0.0.1:${port}/spiel/zufall.mjs`)
    assert.equal(a.status, 200); assert.match(a.headers.get('content-type'), /javascript/)
    assert.match(await a.text(), /export function zufall/)
    for (const p of ['/spiel/gehirn.mjs', '/spiel/schluessel.mjs', '/spiel/../server.mjs', '/spiel/%2e%2e/server.mjs']) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`); await r.text()
      assert.notEqual(r.status, 200, p)
    }
  } finally { await s.schliessen() }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { partieZeile, auswerten, bilanzSatz, soLiefEs, gewinnt } from '../spiel/statistik.mjs'
import { partienSpeicher } from '../spiel/partienspeicher.mjs'
import { tabelle } from '../tools/statistik.mjs'
import { erstelleServer } from '../server.mjs'
import * as P from '../spiel/partie.mjs'
import { zufall } from '../spiel/zufall.mjs'
import { spieleBisZumEnde } from '../spiel/schleife.mjs'
import { skriptGehirn } from '../spiel/skriptgehirne.mjs'

const Z = (rolle, gewonnen, gegen = {}, naechte = 2) => ({ datum: '2026-01-01', rolle, sieger: gewonnen === (rolle === 'schatten') ? 'schatten' : 'schueler', gewonnen, naechte, raus: null, eingesperrtMit: [], gegen })

test('Statistik: auswerten zaehlt Siege nach Rolle, Quote, Serien und den haeufigsten Gegner', () => {
  const a = auswerten([
    Z('schueler', true, { Mira: 1 }), Z('schatten', false, { Mira: 2, Jonas: 1 }), Z('schueler', true, { Jonas: 1 }),
    Z('schluessel', true), Z('schatten', true, { Lea: 1 }), Z('schueler', false, { Jonas: 1 }), Z('schueler', true),
    { kaputt: true }, null, { rolle: 'koenig', gewonnen: true },   // ungueltige Zeilen zaehlen nicht
  ])
  assert.equal(a.partien, 7)
  assert.equal(a.siege, 5)
  assert.equal(a.quote, 5 / 7)
  assert.deepEqual(a.nachRolle.schueler, { partien: 4, siege: 3 })
  assert.deepEqual(a.nachRolle.schatten, { partien: 2, siege: 1 })
  assert.deepEqual(a.nachRolle.schluessel, { partien: 1, siege: 1 })
  assert.deepEqual(a.nachRolle.petze, { partien: 0, siege: 0 })
  assert.equal(a.besteSerie, 3)   // Partie 3 bis 5
  assert.equal(a.serie, 1)        // nur die letzte
  assert.deepEqual(a.gegner, { name: 'Jonas', stimmen: 3 })   // Mira 3 auch, Jonas gewinnt alphabetisch
  assert.equal(a.naechteSchnitt, 2)
  assert.equal(bilanzSatz(a), 'Partie 7: 3 Siege als Schüler, 1 als Schlüsselträger, 1 als Schatten.')
})

test('Statistik: leere Liste, Serie im Satz, Gewinnregel', () => {
  const leer = auswerten([])
  assert.equal(leer.partien, 0); assert.equal(leer.gegner, null); assert.equal(bilanzSatz(leer), '')
  assert.match(tabelle(leer), /Noch keine Partie/)
  assert.equal(bilanzSatz(auswerten([Z('schatten', false)])), 'Partie 1: noch kein Sieg.')
  assert.equal(bilanzSatz(auswerten([Z('petze', true), Z('schueler', true)])), 'Partie 2: 1 Sieg als Schüler, 1 als Petze · 2 Siege in Folge.')
  assert.ok(gewinnt('schatten', 'schatten') && gewinnt('petze', 'schueler') && !gewinnt('schluessel', 'schatten'))
})

test('Statistik: tabelle druckt Rollen, Gesamt und Gegner', () => {
  const t = tabelle(auswerten([Z('schueler', true, { Nora: 2 }), Z('schatten', false)]))
  assert.match(t, /Schüler\s+1\s+1\s+100 %/)
  assert.match(t, /Schatten\s+1\s+0\s+0 %/)
  assert.match(t, /Gesamt\s+2\s+1\s+50 %/)
  assert.match(t, /Häufigster Gegner: Nora \(2 Stimmen/)
  assert.ok(!/Petze/.test(t), 'Rollen ohne Partie fehlen')
})

// Eine ganze Partie mit Skript-Gehirnen, der „Mensch“ ist auch ein Skript
async function skriptPartie(startwert, spieler = 'Alex') {
  const namen = ['Mira', 'Jonas', 'Lea', 'Tarik', 'Nora', 'Sam', spieler]
  const z = zufall(startwert)
  const p = P.neuePartie(namen, z, { spieler })
  const gehirne = Object.fromEntries(namen.map((n) => [n, skriptGehirn(n, p.rollen[n], z)]))
  await spieleBisZumEnde(p, gehirne, { zufall: z })
  return p
}

test('Statistik: partieZeile passt zur Partie und enthaelt den Namen des Menschen nicht', async () => {
  for (let s = 1; s <= 30; s++) {
    const p = await skriptPartie(s)
    const z = partieZeile(p.ereignisse, 'Alex', '2026-02-03')
    assert.equal(z.rolle, p.rollen.Alex)
    assert.equal(z.sieger, p.sieger)
    assert.equal(z.gewonnen, p.rollen.Alex === 'schatten' ? p.sieger === 'schatten' : p.sieger === 'schueler')
    assert.equal(z.naechte, p.naechte.length)
    if (p.verschwunden.includes('Alex')) assert.equal(z.raus.wie, 'verschwunden')
    else if (p.keller.includes('Alex')) assert.equal(z.raus.wie, 'keller')
    else assert.equal(z.raus, null)
    for (const n of z.eingesperrtMit) assert.ok(p.keller.includes(n))
    assert.ok(!JSON.stringify(z).includes('Alex'), 'kein Menschenname in der Zeile')
    assert.ok(Object.keys(z.gegen).every((n) => p.namen.includes(n) && n !== 'Alex'))
    const karte = soLiefEs(p.ereignisse, 'Alex')
    assert.match(karte[0], /^\d+ (Nacht|Nächte)\./)
    assert.ok(karte.some((t) => /^Du warst /.test(t)))
    assert.equal(karte.filter((t) => /^Nacht \d+: /.test(t)).length, p.verschwunden.length)
    assert.equal(karte.filter((t) => /kommt in den Keller|kommst in den Keller/.test(t)).length, p.keller.length)
  }
})

test('Statistik: ohne Menschen oder ohne Ende gibt es keine Zeile, die Karte zeigt nur den Verlauf', async () => {
  const p = await skriptPartie(4)
  assert.equal(partieZeile(p.ereignisse, null), null)
  assert.equal(partieZeile(p.ereignisse.filter((e) => e.art !== 'ende'), 'Alex'), null)
  const zuschauer = soLiefEs(p.ereignisse, null)
  assert.ok(zuschauer.length >= 2 && !zuschauer.some((t) => /\bDu\b|\bdu\b|dich/.test(t)))
  assert.deepEqual(soLiefEs(p.ereignisse.filter((e) => e.art !== 'ende'), 'Alex'), [])
})

test('Partienspeicher: haengt an, Datei 0600, kaputte Zeilen werden uebersprungen', () => {
  const ordner = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ns-partien-')), 'neu')
  const sp = partienSpeicher({ ordner })
  assert.deepEqual(sp.lesen(), [])
  assert.equal(sp.anhaengen(null), false)
  sp.anhaengen(Z('schueler', true)); sp.anhaengen(Z('schatten', false))
  fs.appendFileSync(sp.datei, 'kein json\n')
  assert.equal(sp.lesen().length, 2)
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(sp.datei).mode & 0o777, 0o600)
    assert.equal(fs.statSync(ordner).mode & 0o777, 0o700)
  }
})

// Spielt die Eingaben des Menschen ueber /status und /aktion, bis die Partie zu Ende ist
async function mitspielen(port) {
  const ende = Date.now() + 15000
  const post = (body) => fetch(`http://127.0.0.1:${port}/aktion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  while (Date.now() < ende) {
    const s = await (await fetch(`http://127.0.0.1:${port}/status`)).json()
    if (s?.phase === 'ende') return s
    const w = s?.warte
    if (w?.art === 'sagen') await post({ art: 'sagt', text: 'Ich war am Fenster.' })
    else if (w?.art === 'stimme') await post({ fuer: w.optionen[0] })
    else if (w?.art === 'nacht') await post({ platz: w.orte[0], ziel: w.optionen?.[0] })
    else if (w?.art === 'untersuchen') await post({ ort: null })
    else if (w?.art === 'zeigen') await post({ zeigen: false })
    else await new Promise((f) => setTimeout(f, 5))
  }
  throw new Error('Partie nicht fertig geworden')
}

test('Server: Mitspiel-Partie schreibt genau eine Zeile und meldet die Bilanz, Zuschauen zaehlt nicht', async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-srv-partien-'))
  const statistik = partienSpeicher({ ordner })
  const fabrik = (name, rolle, { zufall: z }) => skriptGehirn(name, rolle, z)
  const s = erstelleServer({ gehirnFabrik: fabrik, statistik, port: 0, pause: 0, startwert: 7, log: () => {} })
  const port = await s.starten()
  const fertig = async () => { for (let i = 0; i < 200 && !(await (await fetch(`http://127.0.0.1:${port}/status`)).json()).bilanz; i++) await new Promise((f) => setTimeout(f, 10)) }
  try {
    const r = await fetch(`http://127.0.0.1:${port}/partie`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Kim' }) })
    assert.equal(r.status, 200)
    await mitspielen(port)
    await fertig()
    const zeilen = statistik.lesen()
    assert.equal(zeilen.length, 1)
    assert.equal(zeilen[0].rolle, s.partie().rollen.Kim)
    assert.ok(!fs.readFileSync(statistik.datei, 'utf8').includes('Kim'), 'kein Menschenname in der Datei')
    if (process.platform !== 'win32') assert.equal(fs.statSync(statistik.datei).mode & 0o777, 0o600)
    const st = await (await fetch(`http://127.0.0.1:${port}/status`)).json()
    assert.match(st.bilanz, /^Partie 1: /)

    await fetch(`http://127.0.0.1:${port}/partie`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zuschauen: true }) })
    for (let i = 0; i < 1500 && s.partie().phase !== 'ende'; i++) await new Promise((f) => setTimeout(f, 10))
    assert.equal(s.partie().phase, 'ende')
    await new Promise((f) => setTimeout(f, 30))
    assert.equal(statistik.lesen().length, 1, 'Zuschauer-Partie wird nicht gezaehlt')
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/status`)).json()).bilanz, null)
  } finally { await s.schliessen() }
})

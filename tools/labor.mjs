// Balance-Labor: spielt Regelvarianten in tausenden Skript-Partien gegeneinander (kein Netz, keine Kosten)
// und zeigt Siegquoten, Partielaenge und Rollenwirkung mit 95-%-Intervallen.
// Aufruf: node tools/labor.mjs [--partien 2000] [--startwert 1] [--varianten datei.json] [--aus bericht.html] [--kein-html]
// Die erste Variante ist die Basis, gegen die alle anderen verglichen werden.

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { regelnMit, abweichungen } from '../spiel/regeln.mjs'
import { SCHATTEN } from '../spiel/rollen.mjs'
import { SCHATTEN_STRATEGIEN } from './skriptgehirne.mjs'
import { spielePartie } from './simuliere.mjs'
import { ALLE_NAMEN } from './balance.mjs'
import { wilson, vergleiche, urteil, spanne, zahl } from './laborstatistik.mjs'
import { berichtHtml } from './laborbericht.mjs'

export const GEMISCHT = 'gemischt'   // Schatten-Strategie wechselt von Partie zu Partie (fest am Startwert)
export const MAX_VARIANTEN = 24
export const MAX_PARTIEN = 200000

// Eingebaute Beispiele. Die erste Zeile ist das Spiel, wie es heute ist.
export const BEISPIEL_VARIANTEN = [
  { name: 'Standard (7 Figuren)' },
  { name: 'Gleichstand: Stichwahl', regeln: { gleichstand: 'stichwahl' } },
  { name: 'Gleichstand: Los', regeln: { gleichstand: 'los' } },
  { name: 'Eine Sprechrunde', regeln: { sprechrunden: 1 } },
  { name: 'Drei Sprechrunden', regeln: { sprechrunden: 3 } },
  { name: 'Ohne Petze', regeln: { petze: false } },
  { name: 'Petze jede Nacht', regeln: { petzeJede: 1 } },
  { name: 'Ohne Untersuchungen', regeln: { maxUntersuchungen: 0 } },
  { name: 'Ohne Tagesereignisse', regeln: { tagesereignisse: false } },
  { name: 'Schluss nach Nacht 2', regeln: { schlussNacht: 2 } },
  { name: '6 Figuren', figuren: 6 },
  { name: '8 Figuren', figuren: 8 },
  { name: 'Schatten-Strategien gemischt', schattenStrategie: GEMISCHT },
]

const ERLAUBT = ['name', 'figuren', 'regeln', 'schattenStrategie']

// Prueft eine Variantenliste (kann aus einer JSON-Datei kommen) und fuellt Standardwerte.
// Namen sind Daten: Steuerzeichen raus, gekuerzt; im Bericht werden sie zusaetzlich maskiert.
export function pruefeVarianten(liste) {
  if (!Array.isArray(liste) || liste.length < 1) throw new Error('Varianten: eine Liste mit mindestens einem Eintrag erwartet')
  if (liste.length > MAX_VARIANTEN) throw new Error(`Varianten: höchstens ${MAX_VARIANTEN}`)
  const namen = new Set()
  return liste.map((v, i) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`Variante ${i + 1}: Objekt erwartet`)
    for (const k of Object.keys(v)) if (!ERLAUBT.includes(k)) throw new Error(`Variante ${i + 1}: unbekanntes Feld "${String(k).slice(0, 40)}"`)
    if (typeof v.name !== 'string') throw new Error(`Variante ${i + 1}: "name" fehlt`)
    const name = v.name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!name) throw new Error(`Variante ${i + 1}: "name" ist leer`)
    if (namen.has(name)) throw new Error(`Variante ${i + 1}: Name "${name}" kommt doppelt vor`)
    namen.add(name)
    const figuren = v.figuren ?? 7
    if (!Number.isInteger(figuren) || figuren < 4 || figuren > ALLE_NAMEN.length) throw new Error(`Variante "${name}": "figuren" braucht eine ganze Zahl von 4 bis ${ALLE_NAMEN.length}`)
    const schattenStrategie = v.schattenStrategie ?? SCHATTEN_STRATEGIEN[0]
    if (![...SCHATTEN_STRATEGIEN, GEMISCHT].includes(schattenStrategie)) throw new Error(`Variante "${name}": "schattenStrategie" braucht ${[...SCHATTEN_STRATEGIEN, GEMISCHT].join(', ')}`)
    let regeln
    try { regeln = regelnMit(v.regeln ?? {}) } catch (f) { throw new Error(`Variante "${name}": ${f.message}`) }
    return { name, figuren, regeln, schattenStrategie }
  })
}

function pruefeZahl(wert, was, von, bis) {
  if (!Number.isInteger(wert) || wert < von || wert > bis) throw new Error(`${was}: ganze Zahl von ${von} bis ${bis} erwartet`)
  return wert
}

// Welche Strategie der Schatten in Partie mit diesem Startwert spielt (ohne Zufall zu verbrauchen).
export function strategieFuer(variante, startwert) {
  return variante.schattenStrategie === GEMISCHT ? SCHATTEN_STRATEGIEN[startwert % SCHATTEN_STRATEGIEN.length] : variante.schattenStrategie
}

// Spielt eine Variante: `partien` Partien mit den Startwerten startwert, startwert+1, ...
// Liefert nur Zaehlungen (ganze Zahlen); Quoten und Intervalle macht `auswerten`.
export async function spieleVariante(variante, { partien, startwert }) {
  const namen = ALLE_NAMEN.slice(0, variante.figuren)
  const z = {
    name: variante.name, figuren: variante.figuren, regeln: variante.regeln, schattenStrategie: variante.schattenStrategie,
    partien, startwert, schatten: 0, schueler: 0, naechte: 0, laengste: 0,
    schattenNacht1: 0,           // Schatten sitzt nach der ersten Abstimmung im Keller
    schluesselTreffer: 0,        // Partien, in denen der Schluesseltraeger den Schatten geprueft hat
    schluesselTrefferSieg: 0,    // ... und die Schueler danach gewonnen haben
    abstimmungen: 0, ohneKeller: 0, stichwahlen: 0, schluss: 0,
    jeStrategie: {},
  }
  for (let i = 0; i < partien; i++) {
    const strategie = strategieFuer(variante, startwert + i)
    const p = await spielePartie(startwert + i, namen, { regeln: variante.regeln, schattenStrategie: strategie })
    z[p.sieger] += 1
    z.naechte += p.nacht
    z.laengste = Math.max(z.laengste, p.nacht)
    let treffer = false
    for (const e of p.ereignisse) {
      if (e.art === 'pruefung' && e.istSchatten) treffer = true
      else if (e.art === 'eingesperrt') { z.abstimmungen += 1; if (e.nacht === 1 && e.rolle === SCHATTEN) z.schattenNacht1 += 1 }
      else if (e.art === 'niemand') { z.abstimmungen += 1; z.ohneKeller += 1 }
      else if (e.art === 'abstimmung' && e.stichwahl) z.stichwahlen += 1
      else if (e.art === 'ende' && e.grund === 'schluss') z.schluss += 1
    }
    if (treffer) { z.schluesselTreffer += 1; if (p.sieger === 'schueler') z.schluesselTrefferSieg += 1 }
    const s = z.jeStrategie[strategie] ??= { partien: 0, schatten: 0 }
    s.partien += 1
    if (p.sieger === 'schatten') s.schatten += 1
  }
  return z
}

// Aus Zaehlungen werden Quoten mit Intervall. Rein.
export function auswerten(z) {
  return {
    ...z,
    abweichung: abweichungen(z.regeln),
    naechteSchnitt: z.partien ? z.naechte / z.partien : null,
    q: {
      schatten: wilson(z.schatten, z.partien),
      schueler: wilson(z.schueler, z.partien),
      schattenNacht1: wilson(z.schattenNacht1, z.partien),
      schluesselTreffer: wilson(z.schluesselTreffer, z.partien),
      schluesselTrefferSieg: wilson(z.schluesselTrefferSieg, z.schluesselTreffer),
      ohneKeller: wilson(z.ohneKeller, z.abstimmungen),
    },
    strategien: Object.fromEntries(SCHATTEN_STRATEGIEN.filter((k) => z.jeStrategie[k]).map((k) => [k, wilson(z.jeStrategie[k].schatten, z.jeStrategie[k].partien)])),
  }
}

// Das ganze Labor: alle Varianten mit denselben Startwerten, Vergleich jeweils gegen die erste.
export async function labor({ varianten = BEISPIEL_VARIANTEN, partien = 2000, startwert = 1 } = {}) {
  pruefeZahl(partien, 'partien', 1, MAX_PARTIEN)
  pruefeZahl(startwert, 'startwert', 0, 2 ** 31)
  const liste = pruefeVarianten(varianten)
  const ergebnisse = []
  for (const v of liste) ergebnisse.push(auswerten(await spieleVariante(v, { partien, startwert })))
  const basis = ergebnisse[0]
  const vergleich = ergebnisse.slice(1).map((e) => ({ name: e.name, schatten: vergleiche(basis.q.schatten, e.q.schatten), schattenNacht1: vergleiche(basis.q.schattenNacht1, e.q.schattenNacht1) }))
  return { partien, startwert, letzterStartwert: startwert + partien - 1, basis: basis.name, varianten: ergebnisse, vergleich }
}

// Tabelle fuers Terminal.
export function tabelleText(l) {
  const kopf = ['Variante', 'Schatten gewinnt [95 %]', 'Ø Nächte', 'längste', 'Schatten fliegt in Nacht 1', 'Schlüssel findet Schatten', `gegen „${l.basis}“`]
  const zeilen = l.varianten.map((v, i) => [
    v.name, spanne(v.q.schatten), zahl(v.naechteSchnitt), String(v.laengste), spanne(v.q.schattenNacht1), spanne(v.q.schluesselTreffer),
    i === 0 ? 'Basis' : urteil(l.vergleich[i - 1].schatten, 'Schattenquote'),
  ])
  const breite = kopf.map((k, i) => Math.max(k.length, ...zeilen.map((z) => z[i].length)))
  const zeile = (z) => z.map((t, i) => t.padEnd(breite[i])).join(' | ').trimEnd()
  const aus = [
    `Balance-Labor: ${l.partien} Skript-Partien je Variante, Startwerte ${l.startwert}–${l.letzterStartwert}`,
    zeile(kopf), breite.map((b) => '-'.repeat(b)).join('-|-'), ...zeilen.map(zeile),
  ]
  const gemischt = l.varianten.filter((v) => Object.keys(v.strategien).length > 1)
  for (const v of gemischt) {
    aus.push('', `Schatten-Siegquote je Skript-Strategie („${v.name}“):`)
    for (const [k, w] of Object.entries(v.strategien)) aus.push(`  ${k.padEnd(10)} ${spanne(w)}  (${w.n} Partien)`)
  }
  aus.push('', 'Intervalle: Wilson, 95 %. „nicht belegt“ heißt: Die Intervalle überlappen, die Daten tragen keine Aussage.', 'Alle Zahlen gelten für Skript-Gehirne, nicht für Claude-Figuren.')
  return aus.join('\n')
}

// --- Kommandozeile ------------------------------------------------------------------------

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
export const STANDARD_AUSGABE = join(WURZEL, 'ausgabe', 'labor.html')   // ausgabe/ steht in .gitignore

export function leseArgumente(argv) {
  const o = { partien: 2000, startwert: 1, varianten: null, aus: STANDARD_AUSGABE, html: true, hilfe: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const wert = () => { if (i + 1 >= argv.length) throw new Error(`${a} braucht einen Wert`); return argv[++i] }
    const ganzzahl = () => { const w = wert(); if (!/^\d{1,10}$/.test(w)) throw new Error(`${a} braucht eine ganze Zahl`); return Number(w) }
    if (a === '--partien') o.partien = ganzzahl()
    else if (a === '--startwert') o.startwert = ganzzahl()
    else if (a === '--varianten') o.varianten = wert()
    else if (a === '--aus') o.aus = resolve(wert())
    else if (a === '--kein-html') o.html = false
    else if (a === '--hilfe' || a === '-h') o.hilfe = true
    else throw new Error(`Unbekannte Option: ${String(a).slice(0, 40)}`)
  }
  return o
}

export function leseVariantenDatei(pfad) {
  const st = statSync(pfad)
  if (!st.isFile()) throw new Error('Variantendatei ist keine normale Datei')
  if (st.size > 64 * 1024) throw new Error('Variantendatei ist größer als 64 KB')
  const text = readFileSync(pfad, 'utf8')
  let daten
  try { daten = JSON.parse(text) } catch (f) { throw new Error(`Variantendatei ist kein gültiges JSON: ${f.message}`) }
  return pruefeVarianten(daten)
}

const HILFE = `Balance-Labor (Skript-Gehirne, kein Netz, kostet nichts)
  node tools/labor.mjs [--partien 2000] [--startwert 1] [--varianten datei.json] [--aus bericht.html] [--kein-html]
Variantendatei: [{ "name": "…", "figuren": 7, "regeln": { "gleichstand": "stichwahl" }, "schattenStrategie": "lauteste" }, …]
  Die erste Variante ist die Basis. Mit --varianten ersetzt die Datei die eingebauten Beispiele.
  Regeln und ihre Standardwerte: spiel/regeln.mjs. Strategien: ${[...SCHATTEN_STRATEGIEN, GEMISCHT].join(', ')}.`

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const o = leseArgumente(process.argv.slice(2))
    if (o.hilfe) { console.log(HILFE); process.exit(0) }
    const varianten = o.varianten ? leseVariantenDatei(o.varianten) : BEISPIEL_VARIANTEN
    const l = await labor({ varianten, partien: o.partien, startwert: o.startwert })
    console.log(tabelleText(l))
    if (o.html) {
      mkdirSync(dirname(o.aus), { recursive: true })
      writeFileSync(o.aus, berichtHtml(l))
      console.log(`\nBericht: ${o.aus}`)
    }
  } catch (f) {
    console.error(`Fehler: ${f.message}`)
    process.exit(1)
  }
}

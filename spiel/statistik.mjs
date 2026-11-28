// Partien-Statistik: was nach einer Partie fuer den Menschen bleibt, und die Auswertung ueber viele Partien.
// Reine Funktionen ohne node:-Importe: der Browser (Schluss-Karte „So lief es“, auch in der Demo) nutzt
// dieselben Funktionen wie Server und tools/statistik.mjs. Das Speichern steht in ./partienspeicher.mjs.
//
// Eine Zeile pro Partie enthaelt nur Figurennamen, nie den Namen des Menschen und nichts aus den Heften:
//   { datum, rolle, sieger, gewonnen, naechte, raus: null | { nacht, wie: 'verschwunden'|'keller' },
//     eingesperrtMit: [Namen], gegen: { Name: Stimmen gegen den Menschen } }

export const ROLLEN_REIHE = ['schueler', 'schluessel', 'petze', 'schatten']
const ROLLE_ALS = { schueler: 'Schüler', schluessel: 'Schlüsselträger', petze: 'Petze', schatten: 'Schatten' }
const ROLLE_NAME = { schueler: 'ein normaler Schüler', schluessel: 'der Schlüsselträger', petze: 'die Petze', schatten: 'der Schatten' }

// Hat die Rolle mit diesem Sieger gewonnen? Der Schatten spielt allein, alle anderen gehoeren zu den Schuelern.
export const gewinnt = (rolle, sieger) => (rolle === 'schatten' ? sieger === 'schatten' : sieger === 'schueler')

// Eine Zeile aus den Ereignissen einer beendeten Partie (nur oeffentliche Ereignisse plus 'wahrheit').
// Ohne Ende, ohne Sieger oder ohne menschlichen Spieler: null (Zuschauer-Partien werden nicht gezaehlt).
export function partieZeile(ereignisse, spieler, datum = new Date().toISOString().slice(0, 10)) {
  if (!spieler || !Array.isArray(ereignisse)) return null
  const ende = ereignisse.find((e) => e.art === 'ende')
  const wahrheit = ereignisse.find((e) => e.art === 'wahrheit')
  const rolle = wahrheit?.rollen?.[spieler]
  if (!ende?.sieger || !rolle) return null
  let raus = null
  let letzteWahl = null
  const eingesperrtMit = []
  const wahlJeTag = new Map()   // nacht -> letzte Zettelwahl des Tages (eine Stichwahl ersetzt die erste Runde)
  for (const e of ereignisse) {
    if (e.art === 'zettelwahl') {
      letzteWahl = e.stimmen || {}
      wahlJeTag.set(e.nacht, letzteWahl)
    } else if (e.art === 'eingesperrt') {
      if (e.name === spieler) raus ??= { nacht: e.nacht, wie: 'keller' }
      else if (letzteWahl?.[spieler] === e.name) eingesperrtMit.push(e.name)
    } else if (e.art === 'verschwunden' && e.name === spieler) raus ??= { nacht: e.nacht, wie: 'verschwunden' }
  }
  const gegen = {}
  for (const stimmen of wahlJeTag.values()) for (const [von, fuer] of Object.entries(stimmen)) if (fuer === spieler && von !== spieler) gegen[von] = (gegen[von] || 0) + 1
  return {
    datum, rolle, sieger: ende.sieger, gewonnen: gewinnt(rolle, ende.sieger),
    naechte: wahrheit.naechte?.length ?? 0, raus, eingesperrtMit, gegen,
  }
}

const gueltig = (z) => !!z && typeof z === 'object' && ROLLEN_REIHE.includes(z.rolle) && typeof z.gewonnen === 'boolean'

// Auswertung vieler Zeilen (aelteste zuerst): Siege nach Rolle, Quote, Serien, haeufigster Gegner.
export function auswerten(zeilen) {
  const liste = (Array.isArray(zeilen) ? zeilen : []).filter(gueltig)
  const nachRolle = Object.fromEntries(ROLLEN_REIHE.map((r) => [r, { partien: 0, siege: 0 }]))
  const gegner = {}
  let siege = 0, serie = 0, besteSerie = 0, naechte = 0
  for (const z of liste) {
    nachRolle[z.rolle].partien++
    if (z.gewonnen) { siege++; nachRolle[z.rolle].siege++; serie++; besteSerie = Math.max(besteSerie, serie) } else serie = 0
    naechte += Number(z.naechte) || 0
    for (const [n, k] of Object.entries(z.gegen && typeof z.gegen === 'object' ? z.gegen : {})) gegner[n] = (gegner[n] || 0) + (Number(k) || 0)
  }
  // Gegner: die meisten Stimmen gegen den Menschen; bei Gleichstand alphabetisch, damit es stabil bleibt
  const [gName, gStimmen] = Object.entries(gegner).filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? []
  return {
    partien: liste.length, siege, quote: liste.length ? siege / liste.length : 0,
    nachRolle, serie, besteSerie,
    gegner: gName ? { name: gName, stimmen: gStimmen } : null,
    naechteSchnitt: liste.length ? naechte / liste.length : 0,
  }
}

// Eine Zeile fuer die Schluss-Karte: „Partie 7: 3 Siege als Schüler, 1 als Schatten“.
export function bilanzSatz(a) {
  if (!a?.partien) return ''
  const teile = ROLLEN_REIHE.filter((r) => a.nachRolle[r].siege > 0).map((r) => [a.nachRolle[r].siege, ROLLE_ALS[r]])
  const text = teile.map(([k, als], i) => (i === 0 ? `${k} ${k === 1 ? 'Sieg' : 'Siege'} als ${als}` : `${k} als ${als}`)).join(', ')
  return `Partie ${a.partien}: ${text || 'noch kein Sieg'}${a.serie > 1 ? ` · ${a.serie} Siege in Folge` : ''}.`
}

// Die Schluss-Karte „So lief es“: kurze Zeilen aus den Ereignissen, die der Browser gesehen hat.
// spieler = null (Zuschauer): nur der Verlauf, ohne „du“.
export function soLiefEs(ereignisse, spieler = null) {
  const zeilen = []
  const ende = ereignisse.find((e) => e.art === 'ende')
  if (!ende) return zeilen
  const wahrheit = ereignisse.find((e) => e.art === 'wahrheit')
  const naechte = wahrheit?.naechte?.length ?? Math.max(0, ...ereignisse.map((e) => e.nacht || 0))
  const wer = (n) => (n === spieler ? 'Du' : n)
  zeilen.push(`${naechte} ${naechte === 1 ? 'Nacht' : 'Nächte'}. ${ende.sieger === 'schueler' ? `Die Schüler haben ${ende.schatten === spieler ? 'dich' : ende.schatten} erwischt.` : `Der Schatten (${ende.schatten === spieler ? 'du' : ende.schatten}) ist davongekommen.`}`)
  for (const e of ereignisse) {
    if (e.art === 'verschwunden') zeilen.push(`Nacht ${e.nacht}: ${wer(e.name)} ${e.name === spieler ? 'bist' : 'ist'} verschwunden.`)
    else if (e.art === 'eingesperrt') zeilen.push(`Tag ${e.nacht}: ${wer(e.name)} ${e.name === spieler ? 'kommst' : 'kommt'} in den Keller (${ROLLE_NAME[e.rolle] ?? 'ein normaler Schüler'}).`)
    else if (e.art === 'niemand') zeilen.push(`Tag ${e.nacht}: niemand in den Keller${e.gleichstand ? ' (Gleichstand)' : ''}.`)
  }
  const z = partieZeile(ereignisse, spieler, '')
  if (z) {
    zeilen.push(`Du warst ${ROLLE_NAME[z.rolle]} und hast ${z.gewonnen ? 'gewonnen' : 'verloren'}.${z.raus ? '' : ' Du warst bis zum Schluss dabei.'}`)
    if (z.eingesperrtMit.length) zeilen.push(`Du hast geholfen, ${z.eingesperrtMit.join(' und ')} einzusperren.`)
    const [gName, gK] = Object.entries(z.gegen).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? []
    if (gName) zeilen.push(`Am öftesten gegen dich: ${gName} (${gK}-mal).`)
  }
  return zeilen
}

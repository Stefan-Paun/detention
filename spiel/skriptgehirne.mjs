// Skript-Gehirne: feste Strategien statt Claude. Damit laufen Partien ohne API-Kosten
// durch - fuer Regeltests, Siegquoten und die Simulation. Dieselbe Schnittstelle bekommt
// das Claude-Gehirn (siehe spiel/schleife.mjs). Liegt in spiel/, damit auch die Browser-Demo
// (public/lokal.js) sie laden kann: keine node:-Importe hier.
//
// Die Figuren spielen wie kleine Detektive: Sie bauen aus dem, was sie sehen durften, dieselbe
// Spurentafel wie der Browser (spurentafel.mjs) und halten Behauptungen gegen Beobachtungen.

import { SCHATTEN, SCHLUESSEL, PETZE } from './rollen.mjs'
import { KLASSENBUCH, ORT_NAMEN, bei } from './welt.mjs'
import { wissenAus } from './spurentafel.mjs'

// Wie oft hat jemand jemanden beschuldigt? (aus dem, was die Figur hoeren konnte)
function beschuldigungen(sicht) {
  const z = {}
  for (const e of sicht) if (e.art === 'sagt' && e.an && /schatten|lügst|warst nicht|verdächtig|passt nicht/i.test(e.text)) z[e.an] = (z[e.an] || 0) + 1
  return z
}

function lauteste(sicht, kandidaten) {
  const z = {}
  for (const e of sicht) if (e.art === 'sagt') z[e.von] = (z[e.von] || 0) + 1
  return [...kandidaten].sort((a, b) => (z[b] || 0) - (z[a] || 0))[0]
}

// mitPetze: gibt es in dieser Partie eine Petze? (Nur dann darf sich der Schatten als Petze ausgeben.)
// Wer hat mich oeffentlich als Schatten entlarvt ("Ich bin die Petze ..." / "Ich habe nachts nachgesehen ...")? Die holt der Schatten zuerst.
function entlarver(sicht, name, kandidaten) {
  const k = sicht.filter((e) => e.art === 'sagt' && e.an === name && /^Ich (bin die Petze|habe nachts nachgesehen)/.test(e.text) && kandidaten.includes(e.von))
  return k.length ? k.at(-1).von : null
}

// Wer hat diese Nacht einen Platz behauptet, der nicht zu dem passt, was `ich` sicher weiss?
// -> [{ name, behauptet, war }] (nur Lebende, nie ich selbst)
export function widersprueche(sicht, ich, lebende = null) {
  const w = wissenAus(sicht, ich)
  return Object.entries(w.behauptet)
    .filter(([n, b]) => n !== ich && (!lebende || lebende.includes(n)) && w.plaetze[n] && w.plaetze[n] !== b)
    .map(([n, b]) => ({ name: n, behauptet: b, war: w.plaetze[n] }))
}

// Wo luegt der Schatten, er sei gewesen? Nie sein echter Platz; dort, wo er nachts jemanden
// wusste (ein Zeuge koennte ihn widerlegen), seltener.
function luegenPlatz(sicht, ich, echt, zufall) {
  const w = wissenAus(sicht, ich)
  const zeugen = new Set(Object.entries(w.plaetze).filter(([n]) => n !== ich).map(([, o]) => o))
  const topf = ORT_NAMEN.filter((o) => o !== echt).flatMap((o) => (zeugen.has(o) ? [o] : [o, o, o]))
  return zufall.aus(topf)
}

// Balance (test/petze.test.mjs + test/demo.test.mjs: Schatten 40-60 % bei 4-7 Figuren, gemessen 41-54 %):
const WAHRHEIT_SCHATTEN = 0.85   // so oft nennt der Skript-Schatten seinen echten Platz
const FALSCHER_VORWURF = 0.7    // so oft erfindet er einen Widerspruch gegen jemanden, den er nachts nicht gesehen hat
const letzteNacht = (sicht) => sicht.reduce((n, e) => Math.max(n, e.nacht || 0), 0)

// Wen der Skript-Schatten nachts holt, wenn ihn niemand entlarvt hat. 'lauteste' ist der Standard.
export const SCHATTEN_STRATEGIEN = ['lauteste', 'leiseste', 'zufall']

function leiseste(sicht, kandidaten) {
  const z = {}
  for (const e of sicht) if (e.art === 'sagt') z[e.von] = (z[e.von] || 0) + 1
  return [...kandidaten].sort((a, b) => (z[a] || 0) - (z[b] || 0))[0]
}

export function skriptGehirn(name, rolle, zufall, { mitPetze = true, schattenStrategie = 'lauteste' } = {}) {
  if (!SCHATTEN_STRATEGIEN.includes(schattenStrategie)) throw new Error(`Unbekannte Schatten-Strategie: ${String(schattenStrategie).slice(0, 40)}`)
  const holen = (sicht, k) => schattenStrategie === 'zufall' ? zufall.aus(k) : schattenStrategie === 'leiseste' ? leiseste(sicht, k) : lauteste(sicht, k)
  const geprueft = {}             // nur Schluesseltraeger und Petze fuellen das: Name -> ist Schatten
  const gesehen = {}              // nur die Petze: Name -> Rolle, die sie erfahren hat
  let meinPlatz = null
  let luege = null                // nur der Schatten: der Platz, den er fuer diese Nacht behauptet
  const gesagt = new Set()        // was diese Figur schon gesagt hat ("<nacht>:<art>:<name>"), damit sie sich nicht wiederholt
  return {
    name,
    abend(sicht, lebende) {
      return { text: zufall.aus(['Ist jemand bei der Tür gewesen?', 'Mir ist kalt.', 'Wer hat das Licht gesehen?', 'Ich war die ganze Zeit hier.']) }
    },
    nacht(sicht, lebende, { orte, ziele, petzeAktiv = true }) {
      const andere = lebende.filter((n) => n !== name)
      meinPlatz = zufall.aus(orte)
      // Der Schatten sagt oft die Wahrheit ueber seinen Platz (das ist sicher), sonst eine Luege
      if (rolle === SCHATTEN) luege = zufall.zahl() < WAHRHEIT_SCHATTEN ? meinPlatz : luegenPlatz(sicht, name, meinPlatz, zufall)
      if (rolle === SCHATTEN) return { platz: meinPlatz, ziel: entlarver(sicht, name, ziele ?? andere) ?? holen(sicht, ziele ?? andere) }
      if (rolle === SCHLUESSEL) {
        const offen = andere.filter((n) => !(n in geprueft))
        return { platz: meinPlatz, ziel: offen.length ? zufall.aus(offen) : zufall.aus(andere) }
      }
      if (rolle === PETZE && petzeAktiv) {
        // Verdaechtige zuerst: wer am meisten beschuldigt wurde, sonst irgendwer Ungeprueftes
        const offen = andere.filter((n) => !(n in gesehen))
        const b = beschuldigungen(sicht)
        const reihe = [...offen].sort((x, y) => (b[y] || 0) - (b[x] || 0))
        return { platz: meinPlatz, ziel: reihe.length ? ((b[reihe[0]] || 0) > 0 ? reihe[0] : zufall.aus(reihe)) : zufall.aus(andere) }
      }
      return { platz: meinPlatz }
    },
    merkePruefung(ziel, istSchatten) { geprueft[ziel] = istSchatten },
    merkePetze(ziel, gefundeneRolle) { gesehen[ziel] = gefundeneRolle; geprueft[ziel] = gefundeneRolle === SCHATTEN },
    untersuchen(sicht, lebende, { orte }) {
      if (zufall.zahl() < 0.3) return null
      // Lieber dort nachsehen, wo der letzte Fund hinzeigt, sonst irgendwo
      const fund = [...sicht].reverse().find((e) => e.art === 'fund')
      const treffer = fund && orte.find((o) => fund.text.includes(o))
      return { ort: treffer && zufall.zahl() < 0.6 ? treffer : (zufall.zahl() < 0.25 ? KLASSENBUCH : zufall.aus(orte.filter((o) => o !== KLASSENBUCH))) }
    },
    zeigen(sicht, lebende, { ergebnis }) { return rolle !== SCHATTEN && (ergebnis.namen?.length > 0 || ergebnis.durchgang) && zufall.zahl() < 0.6 },
    diskussion(sicht, lebende) {
      const andere = lebende.filter((n) => n !== name)
      const bekannt = Object.entries(geprueft).find(([n, s]) => s && lebende.includes(n))
      if (bekannt) return { art: 'sagt', an: bekannt[0], text: rolle === PETZE ? `Ich bin die Petze, ich habe ${bekannt[0]} nachts durchschaut: ${bekannt[0]} ist der Schatten.` : `Ich habe nachts nachgesehen: ${bekannt[0]} ist der Schatten.` }
      // Der Schatten gibt sich manchmal als Petze aus und beschuldigt jemand anderen
      if (rolle === SCHATTEN && mitPetze && andere.length && zufall.zahl() < 0.12) { const o = zufall.aus(andere); return { art: 'sagt', an: o, text: `Ich bin die Petze, ich habe ${o} nachts durchschaut: ${o} ist der Schatten.` } }
      const nacht = letzteNacht(sicht)
      const neu = (schluessel) => { if (gesagt.has(`${nacht}:${schluessel}`)) return false; gesagt.add(`${nacht}:${schluessel}`); return true }
      // 1. Widerspruch: jemand behauptet einen Platz, an dem er nicht war -> genau das sagen
      const wid = widersprueche(sicht, name, lebende).find((x) => !gesagt.has(`${nacht}:wid:${x.name}`))
      if (wid && neu(`wid:${wid.name}`)) return { art: 'sagt', an: wid.name, text: `${wid.name}, du sagst, du warst ${bei(wid.behauptet)}. Aber du warst ${bei(wid.war)}, das passt nicht.` }
      // 1b. Der Schatten erfindet manchmal einen Widerspruch gegen jemanden, der einen Platz behauptet hat
      if (rolle === SCHATTEN && zufall.zahl() < FALSCHER_VORWURF) {
        const w0 = wissenAus(sicht, name)
        const opfer = Object.entries(w0.behauptet).filter(([n, b]) => n !== name && lebende.includes(n) && !w0.plaetze[n] && !gesagt.has(`${nacht}:wid:${n}`))
        if (opfer.length) { const [n, b] = zufall.aus(opfer); neu(`wid:${n}`); return { art: 'sagt', an: n, text: `${n}, du sagst, du warst ${bei(b)}. Aber du warst ${bei(zufall.aus(ORT_NAMEN.filter((o) => o !== b)))}, das passt nicht.` } }
      }
      // 2. Den eigenen Platz nennen (der Schatten luegt, aber nicht immer gleich)
      if (meinPlatz && nacht && zufall.zahl() < 0.6 && neu('platz')) return { art: 'sagt', an: null, text: `Ich war ${bei(rolle === SCHATTEN ? (luege ?? meinPlatz) : meinPlatz)}, die ganze Nacht.` }
      // 3. Eine echte Beobachtung weitergeben (wer stand wo), jede nur einmal
      const w = wissenAus(sicht, name)
      const sicher = Object.entries(w.plaetze).filter(([n]) => n !== name && n !== w.opfer && lebende.includes(n) && !gesagt.has(`${nacht}:sah:${n}`))
      if (sicher.length && zufall.zahl() < 0.7) { const [n, o] = zufall.aus(sicher); neu(`sah:${n}`); return { art: 'sagt', an: null, text: `Ich weiß sicher: ${n} stand heute Nacht ${bei(o)}.` } }
      // 4. Ohne Wissen wie frueher
      if (zufall.zahl() < 0.4) return { art: 'schweigt' }
      const ziel = rolle === SCHATTEN ? zufall.aus(andere) : (Object.entries(beschuldigungen(sicht)).filter(([n]) => andere.includes(n)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? zufall.aus(andere))
      return { art: 'sagt', an: ziel, text: `${ziel}, du warst nicht an deinem Platz.` }
    },
    abstimmung(sicht, lebende, { kandidaten = null } = {}) {
      // Stichwahl: nur die Gleichen stehen zur Wahl (ohne Stichwahl ist die Liste wie bisher)
      const andere = (kandidaten ?? lebende).filter((n) => n !== name)
      if (!andere.length) return { fuer: null }
      const bekannt = Object.entries(geprueft).find(([n, s]) => s && andere.includes(n))
      if (bekannt) return { fuer: bekannt[0] }
      // Widerspruch zwischen Behauptung und Beobachtung schlaegt Geruechte (der Schatten nutzt das auch)
      const wid = widersprueche(sicht, name, andere)
      if (wid.length) return { fuer: wid[0].name }
      const b = beschuldigungen(sicht)
      const sauber = andere.filter((n) => geprueft[n] !== false)
      const reihe = (sauber.length ? sauber : andere).sort((x, y) => (b[y] || 0) - (b[x] || 0))
      if (rolle === SCHATTEN) return { fuer: reihe.find((n) => (b[n] || 0) > 0) ?? zufall.aus(andere) }
      return { fuer: (b[reihe[0]] || 0) > 0 ? reihe[0] : (zufall.zahl() < 0.3 ? null : zufall.aus(reihe)) }
    },
  }
}

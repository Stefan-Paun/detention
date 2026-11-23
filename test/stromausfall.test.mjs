// Tagesereignis "Stromausfall": die erste Gespraechsrunde ohne Namen (Regeln, Sichtbarkeit, Text fuer Claude, Simulation).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zufall } from '../spiel/zufall.mjs'
import * as P from '../spiel/partie.mjs'
import { tagesereignis } from '../spiel/welt.mjs'
import { verlaufAlsText } from '../spiel/gehirn.mjs'
import { spurentafelText } from '../spiel/spurentafel.mjs'
import { spielePartie } from '../tools/simuliere.mjs'

const NAMEN = ['Mira', 'Jonas', 'Lea', 'Tarik', 'Nora', 'Stefan']
const ORTE = P.ORT_NAMEN

test('Tagesereignis: ueber 500 Startwerte kommen alle Arten vor, Stromausfall um 10 %, ruhige Tage mindestens 15 %', () => {
  const plaetze = { Mira: 'Tür', Jonas: 'Tafel', Lea: 'Fenster', Tarik: 'Pulte', Nora: 'Fenster' }
  const arten = {}
  for (let s = 1; s <= 500; s++) { const e = tagesereignis({ plaetze, schatten: 'Jonas', zufall: zufall(s) }); arten[e?.art ?? 'nichts'] = (arten[e?.art ?? 'nichts'] || 0) + 1 }
  for (const a of ['zettel', 'hausmeister', 'glocke', 'stromausfall', 'nichts']) assert.ok(arten[a] > 20, `${a} kommt zu selten (${arten[a] ?? 0})`)
  assert.ok(arten.stromausfall < 90, `Stromausfall zu oft (${arten.stromausfall})`)
  assert.ok(arten.nichts >= 50, `ruhige Tage zu selten (${arten.nichts})`)
})

// Eine Partie bis zur Diskussion, deren erster Tag mit Stromausfall beginnt
function dunklePartie() {
  for (let s = 1; s < 500; s++) {
    const p = P.neuePartie(NAMEN, zufall(s))
    P.sprechen(p, 'Mira', 'Hallo zusammen.'); P.abendBeenden(p)
    const k = P.schluesseltraeger(p)
    p.lebende.forEach((n, i) => P.platzWaehlen(p, n, ORTE[i % ORTE.length]))
    P.schattenWaehlt(p, P.holbar(p).find((n) => n !== k))
    P.schluesselPrueft(p, p.lebende.find((n) => n !== k))
    P.morgen(p)
    if (p.phase === 'diskussion' && p.dunkel) return p
  }
  throw new Error('kein Startwert mit Stromausfall')
}

test('Stromausfall: in Runde 1 sehen Figuren keinen Absender, ab Runde 2 wieder', () => {
  const p = dunklePartie()
  const [a, b] = p.lebende
  assert.ok(P.imDunkeln(p))
  assert.ok(p.ereignisse.some((e) => e.art === 'stromausfall' && e.sichtbar.length === NAMEN.length), 'alle erfahren vom Stromausfall')

  P.sprechen(p, a, 'Ich war am Fenster.', b, 'Fenster')
  const sagt = p.ereignisse.findLast((e) => e.art === 'sagt')
  assert.equal(sagt.von, P.DUNKLE_STIMME)
  assert.equal(sagt.an, null, 'im Dunkeln spricht man niemanden an')
  assert.equal(sagt.behauptet, null, 'eine Behauptung ohne Namen zaehlt nicht')
  assert.equal(sagt.dunkel, true)
  assert.deepEqual(sagt.sichtbar, p.lebende)
  const { sichtbar: _, ...oeffentlich } = sagt
  assert.ok(!JSON.stringify(oeffentlich).includes(a), 'der Sprecher steht nirgends im oeffentlichen Ereignis')

  const privat = p.ereignisse.at(-1)
  assert.equal(privat.art, 'im-dunkeln')
  assert.deepEqual(privat.sichtbar, [a], 'nur der Sprecher weiss, dass er es war')
  assert.equal(privat.wer, a); assert.equal(privat.sagt, sagt.nr)

  P.schweigen(p, b)
  assert.deepEqual(p.ereignisse.at(-1).sichtbar, [b], 'im Dunkeln merkt niemand, wer schweigt')

  // Was Claude zu lesen bekommt
  const fremd = verlaufAlsText(P.verlaufFuer(p, b), b)
  assert.match(fremd, /Stromausfall/)
  assert.match(fremd, /Eine Stimme im Dunkeln: Ich war am Fenster\./)
  assert.ok(!fremd.includes(`${a}: Ich war am Fenster`) && !fremd.includes(`${a} (zu`))
  assert.match(verlaufAlsText(P.verlaufFuer(p, a), a), /Nur du weißt das\] Die Stimme im Dunkeln eben warst du\./)
  assert.doesNotMatch(spurentafelText(P.verlaufFuer(p, b), b, p.lebende), /Behauptet:/)

  // Runde 2: das Licht ist wieder an
  P.naechsteRunde(p)
  assert.equal(p.dunkel, false); assert.ok(!P.imDunkeln(p))
  const licht = p.ereignisse.findLast((e) => e.art === 'licht')
  assert.ok(licht && licht.sichtbar.length === NAMEN.length)
  assert.equal(p.ereignisse.at(-1).art, 'diskussion')
  P.sprechen(p, a, 'Jetzt seht ihr mich.', b)
  const hell = p.ereignisse.at(-1)
  assert.deepEqual([hell.art, hell.von, hell.an, !!hell.dunkel], ['sagt', a, b, false])
  assert.match(verlaufAlsText(P.verlaufFuer(p, b), b), new RegExp(`${a} \\(zu dir\\): Jetzt seht ihr mich\\.`))

  // Die Wahrheit am Ende nennt, wer im Dunkeln sprach
  while (p.phase === 'diskussion') P.naechsteRunde(p)
  const s = P.schatten(p)
  for (const n of p.lebende) P.stimme(p, n, n === s ? p.lebende.find((x) => x !== s) : s)
  P.abstimmungSchliessen(p)
  const w = p.ereignisse.find((e) => e.art === 'wahrheit')
  assert.deepEqual(w.imDunkeln, [{ nacht: 1, von: a, text: 'Ich war am Fenster.' }])
})

test('Stromausfall: die naechste Nacht beginnt hell, auch ohne zweite Runde', () => {
  const p = dunklePartie()
  p.rundenHeute = 1
  P.naechsteRunde(p)
  assert.equal(p.phase, 'abstimmung'); assert.equal(p.dunkel, false)
  P.sprechen(p, p.lebende[0], 'Laut begründet.')
  assert.equal(p.ereignisse.at(-1).von, p.lebende[0])
})

test('Simulation: 300 Skript-Partien mit Stromausfall laufen ohne Fehler, kein Name im Dunkeln', async () => {
  let dunkleTage = 0, saetze = 0
  for (let s = 1; s <= 300; s++) {
    const p = await spielePartie(s)
    assert.ok(p.sieger, `Partie ${s} ohne Sieger`)
    dunkleTage += p.ereignisse.filter((e) => e.art === 'stromausfall').length
    for (const e of p.ereignisse.filter((e) => e.art === 'sagt' && e.dunkel)) {
      saetze++
      assert.equal(e.von, P.DUNKLE_STIMME); assert.equal(e.an, null)
      const privat = p.ereignisse[e.nr + 1]
      assert.equal(privat.art, 'im-dunkeln'); assert.equal(privat.sichtbar.length, 1)
    }
  }
  assert.ok(dunkleTage > 20, `nur ${dunkleTage} Stromausfaelle in 300 Partien`)
  assert.ok(saetze > 20, `nur ${saetze} Saetze im Dunkeln`)
})

test('Stromausfall: Mensch bekommt dunkel in der Frage, zug.mjs bietet kein --an an', async () => {
  const { browserGehirn } = await import('../spiel/browsergehirn.mjs')
  const { hinweisFuer } = await import('../tools/zughinweis.mjs')
  const fragen = []
  const g = browserGehirn('Stefan', 'schueler', { sende: (art, d) => { if (art === 'warte') fragen.push(d) } })
  g.diskussion([{ art: 'stromausfall' }], NAMEN)
  assert.equal(g.wartetAuf().dunkel, true)
  assert.doesNotMatch(hinweisFuer(g.wartetAuf()), /--an Mira/)
  assert.match(hinweisFuer(g.wartetAuf()), /Stromausfall/)
  g.aktion({ art: 'schweigt' })
  g.diskussion([{ art: 'stromausfall' }, { art: 'licht' }], NAMEN)
  assert.equal(g.wartetAuf().dunkel, undefined)
  assert.match(hinweisFuer(g.wartetAuf()), /--an Mira/)
})

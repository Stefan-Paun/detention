import { test } from 'node:test'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { zufall } from '../spiel/zufall.mjs'
import * as P from '../spiel/partie.mjs'
import { STANDARD_REGELN, regelnMit, abweichungen } from '../spiel/regeln.mjs'
import { PETZE_AB, SCHATTEN, PETZE } from '../spiel/rollen.mjs'
import { spielePartie } from '../tools/simuliere.mjs'
import { skriptGehirn } from '../tools/skriptgehirne.mjs'

const NAMEN = ['Mira', 'Jonas', 'Lea', 'Tarik', 'Nora', 'Sam', 'Stefan']

// Spielt eine Nacht von Hand bis in die Abstimmung; liefert den Schatten.
function bisAbstimmung(p) {
  if (p.phase === 'abend') P.abendBeenden(p)
  const s = P.schatten(p), k = P.schluesseltraeger(p)
  for (const n of p.lebende) P.platzWaehlen(p, n, 'Tafel')
  P.schattenWaehlt(p, P.holbar(p).find((n) => n !== k))
  if (P.lebt(p, k)) P.schluesselPrueft(p, p.lebende.find((n) => n !== k && n !== s))
  if (P.petzeAktiv(p)) P.petzePrueft(p, p.lebende.find((n) => n !== P.petze(p)))
  P.morgen(p)
  while (p.phase === 'diskussion') P.naechsteRunde(p)
  return s
}

// Alle stimmen so, dass a und b gleich viele Stimmen bekommen (der Rest enthaelt sich).
function gleichstand(p, a, b) {
  const rest = p.lebende.filter((n) => n !== a && n !== b)
  P.stimme(p, a, b); P.stimme(p, b, a)
  for (const n of rest) P.stimme(p, n, null)
}

test('Regeln: der Standard entspricht den bisherigen Konstanten und ist eingefroren', () => {
  assert.deepEqual({ ...STANDARD_REGELN }, { petze: null, petzeAb: 7, petzeJede: 2, sprechrunden: 2, maxUntersuchungen: 3, gleichstand: 'niemand', schlussNacht: null, tagesereignisse: true })
  assert.equal(P.SPRECHRUNDEN, 2); assert.equal(P.PETZE_JEDE, 2); assert.equal(P.MAX_UNTERSUCHUNGEN, 3); assert.equal(PETZE_AB, 7)
  assert.ok(Object.isFrozen(STANDARD_REGELN))
  const p = P.neuePartie(NAMEN, zufall(1))
  assert.deepEqual({ ...p.regeln }, { ...STANDARD_REGELN })
  assert.ok(Object.isFrozen(p.regeln))
  assert.deepEqual(abweichungen(regelnMit({ sprechrunden: 3, petzeJede: 2 })), { sprechrunden: 3 })
})

test('Regeln: unbekannte Schluessel und falsche Werte werden abgelehnt', () => {
  assert.throws(() => regelnMit({ gibtEsNicht: 1 }), /Unbekannte Regel/)
  assert.throws(() => regelnMit({ sprechrunden: 0 }), /sprechrunden/)
  assert.throws(() => regelnMit({ sprechrunden: '2' }), /sprechrunden/)
  assert.throws(() => regelnMit({ gleichstand: 'wuerfeln' }), /gleichstand/)
  assert.throws(() => regelnMit({ schlussNacht: 0 }), /schlussNacht/)
  assert.throws(() => regelnMit({ petze: 'ja' }), /petze/)
  assert.throws(() => regelnMit([]), /Objekt/)
  assert.throws(() => regelnMit(JSON.parse('{"__proto__": {"x": 1}}')), /Unbekannte Regel/)
  assert.throws(() => P.neuePartie(NAMEN, zufall(1), { regeln: { toString: 1 } }), /Unbekannte Regel/)
})

test('Regeln: ohne Abweichung laeuft eine Partie Ereignis fuer Ereignis wie mit leerem Regel-Objekt', async () => {
  for (const s of [1, 7, 42]) {
    const a = await spielePartie(s), b = await spielePartie(s, NAMEN, { regeln: {} })
    assert.deepEqual(a.ereignisse, b.ereignisse)
  }
})

// Fingerabdruck der Ereignisse von je 40 Partien (Startwerte 1-40), erzeugt auf dem Stand VOR dem Regel-Objekt.
// Schlaegt das fehl, hat sich das Standardspiel geaendert (Ereignisinhalt, Reihenfolge oder Zufallsverbrauch).
// Nach einer gewollten Regelaenderung die Werte neu erzeugen und das im Commit sagen.
const FINGERABDRUCK = {
  4: '183006298e469409c4e3b375413c707c793e47f90f5ce375cc03080e4d5756e3',
  5: '22382de7179ce07d2f58959741ffac0d208fb7882ef077d984c037e030d5e1eb',
  6: '3793835f31b658576b99bc009c957559fe19785f87df4aade68d2d18a32c8192',
  7: 'a3099edd97e9c564651b3317bb0aaa89d2db1163598949f04e5a9d298224072f',
  8: '77117dfd9e024286c5252fd0aadb2ab989ebad7a1f2bac612c712cca71a2e801',
}

test('Regeln: das Standardspiel ist Byte fuer Byte das Spiel von vor dem Regel-Objekt', async () => {
  const ALLE = [...NAMEN, 'Ben']
  for (const [n, soll] of Object.entries(FINGERABDRUCK)) {
    const h = createHash('sha256')
    for (let s = 1; s <= 40; s++) h.update(JSON.stringify((await spielePartie(s, ALLE.slice(0, Number(n)))).ereignisse))
    assert.equal(h.digest('hex'), soll, `${n} Figuren`)
  }
})

test('Regeln: petze/petzeJede als Option haben Vorrang vor dem Regel-Objekt', () => {
  const p = P.neuePartie(NAMEN, zufall(3), { petze: false, petzeJede: 1, regeln: { petze: true, petzeJede: 3 } })
  assert.equal(P.petze(p), undefined)
  assert.equal(p.petzeJede, 1)
  const q = P.neuePartie(NAMEN.slice(0, 5), zufall(3), { regeln: { petzeAb: 5 } })
  assert.ok(Object.values(q.rollen).includes(PETZE))
})

test('Regeln: sprechrunden und maxUntersuchungen wirken', () => {
  const p = P.neuePartie(NAMEN, zufall(5), { regeln: { sprechrunden: 3, maxUntersuchungen: 1, tagesereignisse: false } })
  P.abendBeenden(p)
  const s = P.schatten(p), k = P.schluesseltraeger(p)
  for (const n of p.lebende) P.platzWaehlen(p, n, 'Tafel')
  P.schattenWaehlt(p, P.holbar(p).find((n) => n !== k))
  P.schluesselPrueft(p, p.lebende.find((n) => n !== k && n !== s))
  if (P.petzeAktiv(p)) P.petzePrueft(p, p.lebende.find((n) => n !== P.petze(p)))
  P.morgen(p)
  assert.equal(p.rundenHeute, 3)
  assert.equal(P.untersuchungenUebrig(p, s), 1)
  P.untersuchen(p, s, 'Tafel')
  assert.equal(P.untersuchungenUebrig(p, s), 0)
  P.naechsteRunde(p); P.naechsteRunde(p)
  assert.equal(p.phase, 'diskussion')
  P.naechsteRunde(p)
  assert.equal(p.phase, 'abstimmung')
})

test('Regeln: ohne Tagesereignisse gibt es weder Zettel noch Hausmeister noch Glocke', async () => {
  let mit = 0
  for (let s = 1; s <= 40; s++) {
    const p = await spielePartie(s, NAMEN, { regeln: { tagesereignisse: false } })
    assert.ok(!p.ereignisse.some((e) => ['zettel', 'hausmeister', 'glocke'].includes(e.art)), `Startwert ${s}`)
    if ((await spielePartie(s)).ereignisse.some((e) => ['zettel', 'hausmeister', 'glocke'].includes(e.art))) mit += 1
  }
  assert.ok(mit > 10, 'im Standard kommen Tagesereignisse vor')
})

test('Gleichstand im Standard: niemand kommt in den Keller', () => {
  const p = P.neuePartie(NAMEN, zufall(11))
  bisAbstimmung(p)
  const [a, b] = p.lebende
  gleichstand(p, a, b)
  const erg = P.abstimmungSchliessen(p)
  assert.equal(erg.eingesperrt, null)
  assert.equal(p.keller.length, 0)
  assert.equal(p.phase, 'nacht')
  assert.equal(p.ereignisse.find((e) => e.art === 'zettelwahl').phase, 'ergebnis')
})

test('Gleichstand mit Stichwahl: zweite Runde nur unter den Gleichen, danach faellt die Entscheidung', () => {
  const p = P.neuePartie(NAMEN, zufall(11), { regeln: { gleichstand: 'stichwahl' } })
  const s = bisAbstimmung(p)
  const [a, b] = p.lebende.filter((n) => n !== s)
  gleichstand(p, a, b)
  const erg = P.abstimmungSchliessen(p)
  assert.deepEqual(erg.stichwahl, [a, b])
  assert.equal(p.phase, 'abstimmung')
  assert.equal(p.ereignisse.findLast((e) => e.art === 'zettelwahl').phase, 'abstimmung', 'erste Runde: noch kein Ergebnis')
  assert.deepEqual(p.stimmen, {})
  const ansage = p.ereignisse.at(-1)
  assert.equal(ansage.art, 'abstimmung')
  assert.deepEqual(ansage.stichwahl, [a, b])
  assert.deepEqual(ansage.sichtbar, p.namen, 'die Ansage der Stichwahl sehen alle')
  // Nur die Gleichen stehen zur Wahl
  const dritter = p.lebende.find((n) => n !== a && n !== b)
  assert.throws(() => P.stimme(p, a, dritter), /Stichwahl/)
  for (const n of p.lebende) P.stimme(p, n, n === a ? b : a)
  const zweite = P.abstimmungSchliessen(p)
  assert.equal(zweite.eingesperrt, a)
  assert.equal(p.ereignisse.findLast((e) => e.art === 'zettelwahl').phase, 'ergebnis')
  assert.deepEqual(p.keller, [a])
  assert.equal(p.stichwahl, null, 'die naechste Nacht beginnt ohne Stichwahl')
})

test('Stichwahl: geheime Zettel bleiben auch in der zweiten Runde geheim; wieder Gleichstand = niemand', () => {
  const p = P.neuePartie(NAMEN, zufall(12), { regeln: { gleichstand: 'stichwahl', tagesereignisse: false } })
  bisAbstimmung(p)
  const [a, b] = p.lebende
  gleichstand(p, a, b)
  P.abstimmungSchliessen(p)
  const ab = p.ereignisse.length
  gleichstand(p, a, b)
  for (const e of p.ereignisse.slice(ab)) { assert.equal(e.art, 'stimme'); assert.deepEqual(e.sichtbar, [e.von]) }
  const erg = P.abstimmungSchliessen(p)
  assert.equal(erg.eingesperrt, null)
  assert.equal(erg.stichwahl, undefined, 'keine dritte Runde')
  assert.equal(p.keller.length, 0)
  assert.equal(p.phase, 'nacht')
})

test('Gleichstand mit Los: einer der Gleichen kommt in den Keller, mit demselben Startwert derselbe', () => {
  const lauf = () => {
    const p = P.neuePartie(NAMEN, zufall(13), { regeln: { gleichstand: 'los' } })
    const s = bisAbstimmung(p)
    const [a, b] = p.lebende.filter((n) => n !== s)
    gleichstand(p, a, b)
    return { erg: P.abstimmungSchliessen(p), a, b, p }
  }
  const { erg, a, b, p } = lauf()
  assert.ok([a, b].includes(erg.eingesperrt))
  assert.equal(p.ereignisse.find((e) => e.art === 'eingesperrt').los, true)
  assert.equal(lauf().erg.eingesperrt, erg.eingesperrt)
})

test('schlussNacht: ist der Schatten nach der letzten Abstimmung frei, gewinnt er', () => {
  const p = P.neuePartie(NAMEN, zufall(14), { regeln: { schlussNacht: 1 } })
  const s = bisAbstimmung(p)
  for (const n of p.lebende) P.stimme(p, n, null)
  P.abstimmungSchliessen(p)
  assert.equal(p.phase, 'ende')
  assert.equal(p.sieger, 'schatten')
  assert.equal(p.ereignisse.find((e) => e.art === 'ende').grund, 'schluss')
  // Wird der Schatten in derselben Abstimmung eingesperrt, gewinnen die Schueler
  const q = P.neuePartie(NAMEN, zufall(14), { regeln: { schlussNacht: 1 } })
  const t = bisAbstimmung(q)
  assert.equal(t, s)
  for (const n of q.lebende) P.stimme(q, n, n === t ? null : t)
  P.abstimmungSchliessen(q)
  assert.equal(q.sieger, 'schueler')
  assert.equal(q.ereignisse.find((e) => e.art === 'ende').grund, undefined)
})

test('Regelvarianten: je 150 Skript-Partien enden sauber, keine haengt', async () => {
  const varianten = [{ gleichstand: 'stichwahl' }, { gleichstand: 'los' }, { schlussNacht: 2 }, { sprechrunden: 1, tagesereignisse: false }, { maxUntersuchungen: 0, petzeJede: 1 }]
  for (const regeln of varianten) {
    for (let s = 1; s <= 150; s++) {
      const p = await spielePartie(s, NAMEN, { regeln })
      assert.equal(p.phase, 'ende', `${JSON.stringify(regeln)} Startwert ${s}`)
      assert.ok(['schueler', 'schatten'].includes(p.sieger))
      assert.ok(p.nacht <= P.MAX_NAECHTE)
      if (regeln.schlussNacht) assert.ok(p.nacht <= regeln.schlussNacht)
      assert.deepEqual([...p.lebende, ...p.keller, ...p.verschwunden].sort(), [...NAMEN].sort())
    }
  }
})

test('Stichwahl in der Schleife: kommt in Skript-Partien vor und Stimmen gehen nur an die Gleichen', async () => {
  let stichwahlen = 0
  for (let s = 1; s <= 150; s++) {
    const p = await spielePartie(s, NAMEN, { regeln: { gleichstand: 'stichwahl' } })
    let offen = null
    for (const e of p.ereignisse) {
      if (e.art === 'abstimmung') { offen = e.stichwahl ?? null; if (offen) stichwahlen += 1 }
      if (e.art === 'stimme' && offen && e.fuer != null) assert.ok(offen.includes(e.fuer), `Startwert ${s}: Stimme für ${e.fuer} außerhalb der Stichwahl`)
    }
  }
  assert.ok(stichwahlen > 5, `nur ${stichwahlen} Stichwahlen`)
})

test('Skript-Schatten: Strategien holen verschiedene Ziele, unbekannte Strategie wirft', () => {
  const sicht = [{ art: 'sagt', von: 'Mira', text: 'a' }, { art: 'sagt', von: 'Mira', text: 'b' }, { art: 'sagt', von: 'Lea', text: 'c' }]
  const lebende = ['Mira', 'Lea', 'Nora', 'Sam']
  const ziel = (schattenStrategie) => skriptGehirn('Sam', SCHATTEN, zufall(1), { schattenStrategie }).nacht(sicht, lebende, { orte: ['Tür', 'Tafel'], ziele: ['Mira', 'Lea', 'Nora'] }).ziel
  assert.equal(ziel('lauteste'), 'Mira')
  assert.equal(ziel('leiseste'), 'Nora')
  assert.ok(['Mira', 'Lea', 'Nora'].includes(ziel('zufall')))
  assert.throws(() => skriptGehirn('Sam', SCHATTEN, zufall(1), { schattenStrategie: 'frech' }), /Strategie/)
})

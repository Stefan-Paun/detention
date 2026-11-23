// Partie-Protokoll: Markdown aus einer fertigen Partie, nur Oeffentliches und am Ende Aufgedecktes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { protokollText } from '../spiel/protokoll.mjs'
import { spielePartie } from '../tools/simuliere.mjs'
import * as P from '../spiel/partie.mjs'

test('Protokoll: Kopf mit Startwert, Sieger, Rollen und jede Nacht mit Plaetzen und Opfer', async () => {
  const p = await spielePartie(4)
  const t = protokollText(p, { startwert: 4 })
  assert.match(t, /^# Nachsitzen – Protokoll\n/)
  assert.match(t, /Startwert: 4 \(nachspielbar mit `node tools\/simuliere\.mjs 1 4`/)
  assert.match(t, new RegExp(`Der Schatten war ${P.schatten(p)}\\.`))
  assert.match(t, p.sieger === 'schueler' ? /Die Schüler haben gewonnen/ : /Der Schatten hat gewonnen/)
  for (const n of p.namen) assert.ok(t.includes(`- ${n}: `), `Rolle von ${n} fehlt`)
  for (const n of p.naechte) {
    assert.ok(t.includes(`## Nacht ${n.nacht}`))
    assert.ok(t.includes(`${n.schatten} schleicht zu ${n.opfer}`))
  }
  assert.match(t, /## Ende/)
  assert.ok(t.endsWith('\n'))
})

test('Protokoll: private Ereignisse fehlen (Beobachtungen, Pruefung, Ergebnisse, geheime Zettel)', async () => {
  for (const s of [1, 2, 3, 5, 8]) {
    const p = await spielePartie(s)
    const t = protokollText(p)
    assert.doesNotMatch(t, /Startwert/, 'ohne Startwert kein Startwert-Eintrag')
    for (const e of p.ereignisse) {
      const vorgezeigt = p.ereignisse.some((b) => b.art === 'beweis' && b.text === e.text)   // vorgezeigt ist oeffentlich
      if (['beobachtung', 'ergebnis'].includes(e.art) && !vorgezeigt) assert.ok(!t.includes(e.text), `privat: ${e.art}`)
      if (e.art === 'sagt' && !e.dunkel) assert.ok(t.includes(e.text.replace(/\s+/g, ' ').trim()), 'oeffentliche Saetze stehen drin')
    }
    const offen = p.ereignisse.filter((e) => e.art === 'stimme' && e.sichtbar.length > 1).length
    assert.equal((t.match(/^- \S+ stimmt für /gm) || []).length, offen, 'nur offene Stimmen einzeln, geheime erst als Zettelwahl')
    assert.doesNotMatch(t, /prüft .*Schatten|erfährt von/, 'keine Pruefung, keine Petze-Wahl')
  }
})

test('Protokoll: Spielertext bleibt auf einer Zeile, Mensch ist markiert, Stimme im Dunkeln wird aufgeloest', () => {
  const p = P.neuePartie(['Mira', 'Jonas', 'Lea', 'Alex'], { zahl: () => 0.5, bis: () => 0, aus: (l) => l[0], mischen: (l) => [...l] }, { spieler: 'Alex' })
  P.sprechen(p, 'Alex', 'Hallo\n# Überschrift\n\nzweite Zeile')
  // Stromausfall von Hand, damit der Test nicht vom Zufall abhaengt
  p.phase = 'diskussion'; p.runde = 1; p.dunkel = true; p.nacht = 1
  P.sprechen(p, 'Mira', 'Wer war das?')
  const t = protokollText(p)
  assert.ok(t.includes('**Alex**: Hallo # Überschrift zweite Zeile'))
  assert.ok(!/\n# Überschrift/.test(t))
  assert.ok(t.includes('Alex (Mensch)'))
  assert.ok(t.includes('**Eine Stimme im Dunkeln** (war Mira): Wer war das?'))
})

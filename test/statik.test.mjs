// Barrierefreiheit ohne Browser: feste Attribute in index.html und style.css, Canvas-Beschreibung als reine Funktion.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beschreibeSzene } from '../public/klasse.js'

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')

test('Hinweis wird vorgelesen, Spurentafel hat einen Namen', () => {
  const hinweis = html.match(/<div[^>]*id="hinweis"[^>]*>/)?.[0]
  assert.ok(hinweis, '#hinweis fehlt')
  assert.match(hinweis, /role="status"/)
  assert.match(hinweis, /aria-live="polite"/)
  assert.match(html, /<aside class="tafel"[^>]*aria-label="Spurentafel"/)
})

test('Sichtbarer Fokus und grosse Ziele fuer Touch', () => {
  const fokus = css.match(/([^{}]*):focus-visible[^{]*\{([^}]*)\}/)
  assert.ok(fokus, 'keine :focus-visible-Regel')
  for (const sel of ['.knopf', '.schalter', 'input', 'select']) assert.match(fokus[0], new RegExp(`${sel.replace('.', '\\.')}:focus-visible`))
  assert.match(fokus[2], /var\(--lampe\)/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[^}]*\.schalter\s*\{[^}]*min-height:\s*44px/)
})

const basis = { lebende: ['Mira', 'Jonas', 'Stefan'], verschwunden: [], keller: [], spieler: 'Stefan', plaetze: {} }

test('Canvas-Beschreibung: Tag mit allen im Raum, Spieler als du', () => {
  assert.equal(beschreibeSzene({ ...basis, phase: 'diskussion', nacht: 2 }), 'Das Klassenzimmer. Tag 2, im Raum: Mira, Jonas, du.')
  assert.equal(beschreibeSzene({ ...basis, phase: 'abend', nacht: 0 }), 'Das Klassenzimmer. Abend, im Raum: Mira, Jonas, du.')
})

test('Canvas-Beschreibung: Nacht mit bekannten und unbekannten Plaetzen, Verschwundene und Keller', () => {
  const s = beschreibeSzene({ ...basis, phase: 'nacht', nacht: 3, plaetze: { Stefan: 'Fenster', Mira: 'Tür' }, verschwunden: ['Lea'], keller: ['Tarik'] })
  assert.equal(s, 'Das Klassenzimmer. Nacht 3, an der Tür: Mira; am Fenster: du; Platz unbekannt: Jonas; verschwunden: Lea; im Keller: Tarik.')
})

test('Canvas-Beschreibung: Ende und leere Listen', () => {
  assert.equal(beschreibeSzene({ phase: 'ende', nacht: 4, lebende: [], verschwunden: [], keller: [] }), 'Das Klassenzimmer. Die Partie ist vorbei.')
})

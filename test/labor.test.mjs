import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { wilson, vergleiche, urteil, spanne, prozent } from '../tools/laborstatistik.mjs'
import { labor, pruefeVarianten, tabelleText, leseArgumente, leseVariantenDatei, strategieFuer, auswerten, BEISPIEL_VARIANTEN, MAX_VARIANTEN, GEMISCHT } from '../tools/labor.mjs'
import { berichtHtml, balkenSvg, maskiere } from '../tools/laborbericht.mjs'
import { statistik } from '../tools/simuliere.mjs'
import { STANDARD_REGELN } from '../spiel/regeln.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const nah = (ist, soll, eps = 5e-5) => assert.ok(Math.abs(ist - soll) < eps, `${ist} statt ${soll}`)

// Prueft, dass jedes geoeffnete Tag wieder geschlossen wird (XML-artig, ohne void-Tags) und liefert die Tag-Namen.
function pruefeWohlgeformt(html) {
  const rumpf = html.replace(/^<!doctype html>\n/, '')
  assert.ok(!rumpf.includes('<!'), 'keine Kommentare oder weiteren Deklarationen')
  const stapel = [], namen = new Set()
  let rest = 0
  for (const m of rumpf.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9:-]*="[^"<>]*")*)\s*(\/?)>/g)) {
    const text = rumpf.slice(rest, m.index)
    assert.ok(!/[<>]/.test(text), `rohes < oder > im Text: ${text.slice(0, 60)}`)
    assert.ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(text), `unmaskiertes & im Text: ${text.slice(0, 60)}`)
    rest = m.index + m[0].length
    const [, zu, name, , selbst] = m
    namen.add(name)
    if (selbst) continue
    if (zu) assert.equal(stapel.pop(), name, `</${name}> passt nicht`)
    else stapel.push(name)
  }
  assert.ok(!/[<>]/.test(rumpf.slice(rest)), 'Rest nach dem letzten Tag')
  assert.deepEqual(stapel, [], 'alle Tags geschlossen')
  return namen
}

test('Wilson-Intervall: bekannte Werte', () => {
  let w = wilson(5, 10); nah(w.unten, 0.2366); nah(w.oben, 0.7634); assert.equal(w.quote, 0.5)
  w = wilson(81, 263); nah(w.unten, 0.2553); nah(w.oben, 0.3662)      // Newcombe 1998, Beispiel fuer die Score-Methode
  w = wilson(0, 10); assert.equal(w.unten, 0); nah(w.oben, 0.2775)
  w = wilson(10, 10); nah(w.unten, 0.7225); assert.equal(w.oben, 1)
  w = wilson(1, 1); nah(w.unten, 0.2065); assert.equal(w.oben, 1)
  w = wilson(882, 2000); nah(w.unten, 0.4194); nah(w.oben, 0.4629)
})

test('Wilson-Intervall: Raender, Symmetrie, wird mit mehr Daten enger, lehnt Unsinn ab', () => {
  assert.deepEqual(wilson(0, 0), { treffer: 0, n: 0, quote: null, unten: 0, oben: 1 })
  for (const [x, n] of [[3, 17], [40, 100], [1, 2000]]) {
    const a = wilson(x, n), b = wilson(n - x, n)
    nah(a.unten, 1 - b.oben, 1e-12); nah(a.oben, 1 - b.unten, 1e-12)
    assert.ok(a.unten <= a.quote && a.quote <= a.oben && a.unten >= 0 && a.oben <= 1)
  }
  const klein = wilson(44, 100), gross = wilson(4400, 10000)
  assert.ok(gross.oben - gross.unten < klein.oben - klein.unten)
  assert.throws(() => wilson(5, 3), /Ungültige/)
  assert.throws(() => wilson(-1, 3), /Ungültige/)
  assert.throws(() => wilson(1.5, 3), /Ungültige/)
})

test('Vergleich: belegt nur bei getrennten Intervallen, sonst keine Aussage', () => {
  const basis = wilson(882, 2000)
  const nahe = vergleiche(basis, wilson(900, 2000))
  assert.equal(nahe.ueberlappen, true); assert.equal(nahe.belegt, false); assert.equal(nahe.richtung, null)
  assert.match(urteil(nahe), /^\+0,9 Punkte, nicht belegt/)
  assert.doesNotMatch(urteil(nahe), /höher|niedriger|besser/)
  const hoch = vergleiche(basis, wilson(1038, 2000))
  assert.equal(hoch.belegt, true); assert.equal(hoch.richtung, 'hoeher')
  assert.match(urteil(hoch, 'Schattenquote'), /^\+7,8 Punkte, Schattenquote höher/)
  const tief = vergleiche(basis, wilson(636, 2000))
  assert.equal(tief.richtung, 'niedriger')
  assert.match(urteil(tief), /^−12,3 Punkte, Quote niedriger/)
  // Dieselbe Quote mit wenigen Partien: derselbe Abstand ist dann nicht belegt
  assert.equal(vergleiche(wilson(22, 50), wilson(26, 50)).belegt, false)
  assert.equal(vergleiche(wilson(0, 0), basis).belegt, false)
  assert.equal(urteil(vergleiche(wilson(0, 0), basis)), 'keine Daten')
  assert.equal(spanne(wilson(0, 0)), '–'); assert.equal(prozent(0.4412), '44,1 %')
})

test('Labor: Standardregeln ergeben dieselben Zahlen wie statistik()', async () => {
  const l = await labor({ varianten: [{ name: 'Standard' }], partien: 250, startwert: 5 })
  const st = await statistik(250, 5)
  const v = l.varianten[0]
  assert.equal(v.schatten, st.schatten)
  assert.equal(v.schueler, st.schueler)
  assert.equal(v.laengste, st.laengste)
  assert.equal(+v.naechteSchnitt.toFixed(2), st.naechteSchnitt)
  assert.deepEqual({ ...v.regeln }, { ...STANDARD_REGELN })
  assert.deepEqual(v.abweichung, {})
  assert.equal(v.schatten + v.schueler, 250)
  assert.equal(l.letzterStartwert, 254)
  assert.deepEqual(l.vergleich, [])
})

test('Labor: gleicher Startwert ergibt exakt denselben Bericht, anderer Startwert einen anderen', async () => {
  const o = { varianten: BEISPIEL_VARIANTEN.slice(0, 3).concat(BEISPIEL_VARIANTEN.at(-1)), partien: 60, startwert: 11 }
  const a = await labor(o), b = await labor(o)
  assert.deepEqual(a, b)
  assert.equal(berichtHtml(a), berichtHtml(b))
  assert.equal(tabelleText(a), tabelleText(b))
  const c = await labor({ ...o, startwert: 12 })
  assert.notEqual(berichtHtml(a), berichtHtml(c))
})

test('Labor: Zaehlungen sind in sich stimmig, Strategien teilen die Partien fest nach Startwert auf', async () => {
  const l = await labor({ partien: 90, startwert: 1 })
  assert.equal(l.varianten.length, BEISPIEL_VARIANTEN.length)
  assert.equal(l.vergleich.length, BEISPIEL_VARIANTEN.length - 1)
  for (const v of l.varianten) {
    assert.equal(v.schatten + v.schueler, 90, v.name)
    assert.ok(v.schattenNacht1 <= v.schueler, v.name)
    assert.ok(v.schluesselTrefferSieg <= v.schluesselTreffer && v.schluesselTreffer <= 90, v.name)
    assert.ok(v.ohneKeller <= v.abstimmungen, v.name)
    assert.ok(v.laengste >= v.naechteSchnitt, v.name)
    if (v.regeln.gleichstand !== 'stichwahl') assert.equal(v.stichwahlen, 0, v.name)
    if (v.regeln.schlussNacht) assert.ok(v.laengste <= v.regeln.schlussNacht); else assert.equal(v.schluss, 0, v.name)
  }
  const g = l.varianten.find((v) => v.schattenStrategie === GEMISCHT)
  assert.deepEqual(Object.keys(g.strategien), ['lauteste', 'leiseste', 'zufall'])
  assert.deepEqual(Object.values(g.strategien).map((w) => w.n), [30, 30, 30])
  assert.equal(strategieFuer({ schattenStrategie: GEMISCHT }, 3), 'lauteste')
  assert.equal(strategieFuer({ schattenStrategie: GEMISCHT }, 4), 'leiseste')
  assert.equal(strategieFuer({ schattenStrategie: 'zufall' }, 4), 'zufall')
  assert.deepEqual(Object.keys(l.varianten[0].strategien), ['lauteste'])
})

test('Labor: Varianten werden geprueft (Namen sind Daten, Regeln und Grenzen gelten)', () => {
  const [v] = pruefeVarianten([{ name: `  Mein${String.fromCharCode(10, 7)}Test  ` }])
  assert.deepEqual({ ...v, regeln: { ...v.regeln } }, { name: 'Mein Test', figuren: 7, regeln: { ...STANDARD_REGELN }, schattenStrategie: 'lauteste' })
  assert.equal(pruefeVarianten([{ name: 'x'.repeat(200) }])[0].name.length, 60)
  assert.throws(() => pruefeVarianten([]), /mindestens einem/)
  assert.throws(() => pruefeVarianten({ name: 'a' }), /Liste/)
  assert.throws(() => pruefeVarianten(Array.from({ length: MAX_VARIANTEN + 1 }, (_, i) => ({ name: `v${i}` }))), /höchstens/)
  assert.throws(() => pruefeVarianten([{ name: 'a' }, { name: 'a' }]), /doppelt/)
  assert.throws(() => pruefeVarianten([{ name: '   ' }]), /leer/)
  assert.throws(() => pruefeVarianten([{ figuren: 7 }]), /name/)
  assert.throws(() => pruefeVarianten([{ name: 'a', figuren: 9 }]), /figuren/)
  assert.throws(() => pruefeVarianten([{ name: 'a', figuren: 3 }]), /figuren/)
  assert.throws(() => pruefeVarianten([{ name: 'a', regeln: { sprechrunden: 99 } }]), /Variante "a": Regel "sprechrunden"/)
  assert.throws(() => pruefeVarianten([{ name: 'a', regeln: { geheim: 1 } }]), /Unbekannte Regel/)
  assert.throws(() => pruefeVarianten([{ name: 'a', schattenStrategie: 'frech' }]), /schattenStrategie/)
  assert.throws(() => pruefeVarianten([{ name: 'a', befehl: 'x' }]), /unbekanntes Feld/)
  assert.throws(() => pruefeVarianten([null]), /Objekt/)
})

test('Labor: Anzahl und Startwert werden begrenzt', async () => {
  await assert.rejects(labor({ partien: 0 }), /partien/)
  await assert.rejects(labor({ partien: 1e9 }), /partien/)
  await assert.rejects(labor({ partien: 2.5 }), /partien/)
  await assert.rejects(labor({ partien: 5, startwert: -1 }), /startwert/)
  await assert.rejects(labor({ partien: NaN }), /partien/)
})

test('Labor: auswerten haelt leere Zaehlungen aus (kein Teilen durch null)', () => {
  const leer = auswerten({ name: 'leer', figuren: 7, regeln: STANDARD_REGELN, schattenStrategie: 'lauteste', partien: 0, startwert: 1, schatten: 0, schueler: 0, naechte: 0, laengste: 0, schattenNacht1: 0, schluesselTreffer: 0, schluesselTrefferSieg: 0, abstimmungen: 0, ohneKeller: 0, stichwahlen: 0, schluss: 0, jeStrategie: {} })
  assert.equal(leer.naechteSchnitt, null)
  assert.equal(leer.q.schatten.quote, null)
  assert.match(tabelleText({ partien: 0, startwert: 1, letzterStartwert: 0, basis: 'leer', varianten: [leer], vergleich: [] }), /leer/)
})

test('Bericht: wohlgeformt, ohne externe Verweise, ohne Skript, ohne Datum oder Pfad', async () => {
  const l = await labor({ partien: 40, startwert: 3 })
  const html = berichtHtml(l)
  assert.ok(html.startsWith('<!doctype html>\n<html lang="de">'))
  const namen = pruefeWohlgeformt(html)
  for (const n of ['html', 'head', 'style', 'body', 'svg', 'rect', 'path', 'table', 'pre']) assert.ok(namen.has(n), `<${n}> fehlt`)
  for (const n of ['script', 'link', 'img', 'iframe', 'a', 'object', 'embed', 'form', 'base']) assert.ok(!namen.has(n), `<${n}> hat im Bericht nichts verloren`)
  assert.doesNotMatch(html, /https?:|\/\/|\bsrc=|\bhref=|url\(|@import|xlink|\bon[a-z]+=/i)
  assert.doesNotMatch(html, /\/home\/|\/Users\/|[A-Z]:\\|file:/)
  assert.doesNotMatch(html, /\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b/, 'kein Datum, keine Uhrzeit')
  // Zahlen aus dem Lauf stehen drin: jede Variante, Startwerte, Anzahl
  for (const v of l.varianten) assert.ok(html.includes(maskiere(v.name)), v.name)
  assert.ok(html.includes('40 Skript-Partien je Variante, Startwerte 3–42'))
  assert.ok(html.includes(maskiere(spanne(l.varianten[0].q.schatten))))
  assert.equal((html.match(/<svg /g) || []).length, 2, 'Hauptdiagramm und Strategien')
  assert.equal((html.match(/class="fehler"/g) || []).length, l.varianten.length + 3, 'ein Fehlerstrich je Balken')
})

test('Bericht: Variantennamen aus der Datei werden maskiert', async () => {
  const boese = '<script>alert(1)</script> & "x" \'y\''
  const l = await labor({ varianten: [{ name: 'Basis' }, { name: boese, regeln: { gleichstand: 'los' } }], partien: 20, startwert: 1 })
  const html = berichtHtml(l)
  pruefeWohlgeformt(html)
  assert.ok(!html.includes('<script'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot; &#39;y&#39;'))
  assert.ok(html.includes('{&quot;gleichstand&quot;:&quot;los&quot;}'))
})

test('Bericht: Balken und Fehlerstriche liegen im Diagramm, leere Quote ohne Balken', () => {
  const svg = balkenSvg([{ name: 'A', w: wilson(1, 4) }, { name: 'B', w: wilson(4, 4) }, { name: 'C', w: wilson(0, 0) }], { titel: 'T', band: [0.4, 0.6] })
  assert.equal((svg.match(/class="balken"/g) || []).length, 2)
  const breiten = [...svg.matchAll(/class="balken" x="(\d+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])])
  assert.deepEqual(breiten, [[230, 105], [230, 420]])
  for (const m of svg.matchAll(/class="fehler" d="M([\d.]+) [\d.]+V[\d.]+M[\d.]+ [\d.]+H([\d.]+)/g)) {
    assert.ok(Number(m[1]) >= 230 && Number(m[2]) <= 650 && Number(m[1]) <= Number(m[2]))
  }
})

test('Kommandozeile: Argumente, Variantendatei, Zieldatei per Option', async () => {
  const o = leseArgumente(['--partien', '50', '--startwert', '9', '--kein-html'])
  assert.equal(o.partien, 50); assert.equal(o.startwert, 9); assert.equal(o.html, false)
  assert.match(leseArgumente([]).aus, /ausgabe[\\/]labor\.html$/)
  assert.throws(() => leseArgumente(['--unsinn']), /Unbekannte Option/)
  assert.throws(() => leseArgumente(['--partien']), /braucht einen Wert/)
  for (const unsinn of ['', '0x10', '1e3', '-5', '2.5', 'viele']) assert.throws(() => leseArgumente(['--partien', unsinn]), /ganze Zahl/, unsinn)
  assert.throws(() => leseArgumente(['--startwert', '']), /ganze Zahl/)
  assert.match(readFileSync(join(WURZEL, '.gitignore'), 'utf8'), /^ausgabe\/$/m, 'Standard-Ausgabeordner ist ignoriert')

  const ordner = mkdtempSync(join(tmpdir(), 'nachsitzen-labor-'))
  try {
    const datei = join(ordner, 'varianten.json'), ziel = join(ordner, 'unter', 'bericht.html')
    writeFileSync(datei, JSON.stringify([{ name: 'Basis' }, { name: 'Mit Los', regeln: { gleichstand: 'los' }, figuren: 6 }]))
    assert.equal(leseVariantenDatei(datei)[1].figuren, 6)
    const aus = execFileSync(process.execPath, [join(WURZEL, 'tools', 'labor.mjs'), '--partien', '30', '--startwert', '2', '--varianten', datei, '--aus', ziel], { encoding: 'utf8' })
    assert.match(aus, /30 Skript-Partien je Variante, Startwerte 2–31/)
    assert.match(aus, /Mit Los/)
    assert.ok(existsSync(ziel))
    const html = readFileSync(ziel, 'utf8')
    pruefeWohlgeformt(html)
    const imProzess = await labor({ varianten: leseVariantenDatei(datei).map((v) => ({ ...v, regeln: { ...v.regeln } })), partien: 30, startwert: 2 })
    assert.equal(html, berichtHtml(imProzess), 'Datei = berichtHtml(labor(...))')

    writeFileSync(datei, '{ kaputt')
    const f = spawnSync(process.execPath, [join(WURZEL, 'tools', 'labor.mjs'), '--varianten', datei, '--kein-html'], { encoding: 'utf8' })
    assert.equal(f.status, 1)
    assert.match(f.stderr, /^Fehler: Variantendatei ist kein gültiges JSON/)
    writeFileSync(datei, JSON.stringify([{ name: 'a', regeln: { gleichstand: 'x' } }]))
    assert.match(spawnSync(process.execPath, [join(WURZEL, 'tools', 'labor.mjs'), '--varianten', datei, '--kein-html'], { encoding: 'utf8' }).stderr, /Regel "gleichstand"/)
    writeFileSync(datei, ' '.repeat(70 * 1024))
    assert.throws(() => leseVariantenDatei(datei), /64 KB/)
    assert.throws(() => leseVariantenDatei(ordner), /keine normale Datei/)
  } finally { rmSync(ordner, { recursive: true, force: true }) }
})

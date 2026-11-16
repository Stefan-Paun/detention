// HTML-Bericht des Balance-Labors: eine Datei, keine externen Verweise, kein Skript.
// Rein: gleiche Eingabe ergibt Zeichen fuer Zeichen dieselbe Datei (kein Datum, keine Uhrzeit, kein Pfad).
// Alle Tags sind geschlossen (XML-tauglich), jeder Text aus den Daten wird maskiert.

import { STANDARD_REGELN } from '../spiel/regeln.mjs'
import { urteil, spanne, prozent, zahl } from './laborstatistik.mjs'

export function maskiere(text) {
  return String(text).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]))
}

const STIL = `
:root { --flaeche: #fcfcfb; --seite: #f9f9f7; --tinte: #0b0b0b; --leise: #52514e; --linie: #d9d8d3; --balken: #2a78d6; --band: #ecebe6; }
@media (prefers-color-scheme: dark) {
  :root { --flaeche: #1a1a19; --seite: #0d0d0d; --tinte: #f0efec; --leise: #c3c2b7; --linie: #3d3d39; --balken: #3987e5; --band: #2a2a28; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--seite); color: var(--tinte); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 980px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 8px; }
p { margin: 8px 0; overflow-wrap: anywhere; }
.leise { color: var(--leise); }
.karte { background: var(--flaeche); border: 1px solid var(--linie); border-radius: 8px; padding: 12px; overflow-x: auto; }
svg { display: block; width: 100%; height: auto; min-width: 640px; }
svg text { font: 12px system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--tinte); }
svg .achse { fill: var(--leise); }
svg .gitter { stroke: var(--linie); stroke-width: 1; }
svg .mitte { stroke: var(--leise); stroke-width: 1; stroke-dasharray: 3 3; }
svg .band { fill: var(--band); }
svg .balken { fill: var(--balken); }
svg .fehler { stroke: var(--tinte); stroke-width: 1.5; fill: none; }
table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--linie); vertical-align: top; white-space: nowrap; }
th { color: var(--leise); font-weight: 600; }
td.frei { white-space: normal; }
code, pre { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
`

// Waagrechte Balken (Quote 0-100 %) mit Fehlerstrich fuer das 95-%-Intervall.
// zeilen: [{ name, w }] mit w = Ergebnis von wilson(). band = [von, bis] markiert einen Zielbereich.
export function balkenSvg(zeilen, { titel, band = null } = {}) {
  const links = 230, breite = 420, rechts = 230, oben = 26, hoehe = 30, unten = 30
  const W = links + breite + rechts, H = oben + zeilen.length * hoehe + unten
  const x = (q) => +(links + breite * q).toFixed(1)
  const teile = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${maskiere(titel)}">`, `<title>${maskiere(titel)}</title>`]
  const y0 = oben, y1 = oben + zeilen.length * hoehe
  if (band) teile.push(`<rect class="band" x="${x(band[0])}" y="${y0}" width="${+(x(band[1]) - x(band[0])).toFixed(1)}" height="${y1 - y0}"/>`)
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    teile.push(`<line class="${t === 0.5 ? 'mitte' : 'gitter'}" x1="${x(t)}" y1="${y0}" x2="${x(t)}" y2="${y1}"/>`)
    teile.push(`<text class="achse" x="${x(t)}" y="${y1 + 18}" text-anchor="middle">${100 * t} %</text>`)
  }
  if (band) teile.push(`<text class="achse" x="${x((band[0] + band[1]) / 2)}" y="${y0 - 8}" text-anchor="middle">Ziel ${100 * band[0]}–${100 * band[1]} %</text>`)
  zeilen.forEach((z, i) => {
    const m = oben + i * hoehe + hoehe / 2
    const name = z.name.length > 34 ? `${z.name.slice(0, 33)}…` : z.name
    teile.push('<g>', `<title>${maskiere(`${z.name}: ${spanne(z.w)}, ${z.w.treffer} von ${z.w.n}`)}</title>`)
    teile.push(`<text x="${links - 10}" y="${m + 4}" text-anchor="end">${maskiere(name)}</text>`)
    if (z.w.quote != null) {
      teile.push(`<rect class="balken" x="${links}" y="${m - 7}" width="${+(breite * z.w.quote).toFixed(1)}" height="14" rx="3"/>`)
      teile.push(`<path class="fehler" d="M${x(z.w.unten)} ${m - 5}V${m + 5}M${x(z.w.unten)} ${m}H${x(z.w.oben)}M${x(z.w.oben)} ${m - 5}V${m + 5}"/>`)
    }
    teile.push(`<text x="${links + breite + 10}" y="${m + 4}">${maskiere(spanne(z.w))}</text>`, '</g>')
  })
  teile.push('</svg>')
  return teile.join('\n')
}

function tabelle(kopf, zeilen) {
  return ['<table>', `<thead><tr>${kopf.map((k) => `<th>${maskiere(k)}</th>`).join('')}</tr></thead>`, '<tbody>',
    ...zeilen.map((z) => `<tr>${z.map((t) => typeof t === 'object' ? `<td class="frei">${t.html}</td>` : `<td>${maskiere(t)}</td>`).join('')}</tr>`), '</tbody>', '</table>'].join('\n')
}

// l = Ergebnis von labor() in tools/labor.mjs.
export function berichtHtml(l) {
  const v = l.varianten
  const haupt = tabelle(
    ['Variante', 'Figuren', 'Schatten gewinnt [95 %]', 'Schüler gewinnen [95 %]', 'Ø Nächte', 'längste', 'Schatten fliegt in Nacht 1', 'Schlüssel findet Schatten', 'danach Schüler-Sieg', 'Abstimmung ohne Keller'],
    v.map((e) => [e.name, String(e.figuren), spanne(e.q.schatten), spanne(e.q.schueler), zahl(e.naechteSchnitt), String(e.laengste), spanne(e.q.schattenNacht1), spanne(e.q.schluesselTreffer), spanne(e.q.schluesselTrefferSieg), spanne(e.q.ohneKeller)]),
  )
  const vergleich = l.vergleich.length ? tabelle(
    ['Variante', 'Schattenquote', `gegen „${l.basis}“`, 'Schatten fliegt in Nacht 1', `gegen „${l.basis}“`],
    l.vergleich.map((c, i) => [c.name, prozent(v[i + 1].q.schatten.quote), urteil(c.schatten, 'Schattenquote'), prozent(v[i + 1].q.schattenNacht1.quote), urteil(c.schattenNacht1, 'Quote')]),
  ) : ''
  const gemischt = v.filter((e) => Object.keys(e.strategien).length > 1)
  const strategien = gemischt.map((e) => [
    `<h2>Schatten-Siegquote je Skript-Strategie („${maskiere(e.name)}“)</h2>`,
    `<div class="karte">${balkenSvg(Object.entries(e.strategien).map(([name, w]) => ({ name, w })), { titel: `Schatten-Siegquote je Strategie, ${e.name}` })}</div>`,
    '<p class="leise">lauteste = holt, wer am meisten geredet hat (Standard); leiseste = holt, wer am wenigsten geredet hat; zufall = holt irgendwen. Jede Partie spielt genau eine Strategie, fest nach Startwert.</p>',
  ].join('\n')).join('\n')
  const nachstellen = tabelle(
    ['Variante', 'Figuren', 'Schatten-Strategie', 'Abweichung vom Standard'],
    v.map((e) => [e.name, String(e.figuren), e.schattenStrategie, { html: `<code>${maskiere(JSON.stringify(e.abweichung))}</code>` }]),
  )
  const datei = `[\n${v.map((e) => ` ${JSON.stringify({ name: e.name, figuren: e.figuren, regeln: e.abweichung, schattenStrategie: e.schattenStrategie })}`).join(',\n')}\n]`
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Nachsitzen – Balance-Labor</title>
<style>${STIL}</style>
</head>
<body>
<main>
<h1>Balance-Labor</h1>
<p class="leise">${l.partien} Skript-Partien je Variante, Startwerte ${l.startwert}–${l.letzterStartwert} (Partie <i>i</i> nutzt Startwert ${l.startwert} + <i>i</i>, alle Varianten dieselben). Kein Netz, keine KI-Aufrufe.</p>

<h2>Wie oft gewinnt der Schatten?</h2>
<div class="karte">
${balkenSvg(v.map((e) => ({ name: e.name, w: e.q.schatten })), { titel: 'Siegquote des Schattens je Variante mit 95-%-Intervall', band: [0.4, 0.6] })}
</div>
<p class="leise">Balken = gemessene Quote, Strich = Wilson-Intervall (95 %). Das graue Band ist der Zielbereich aus docs/balance-petze.md.</p>

<h2>Alle Zahlen</h2>
<div class="karte">
${haupt}
</div>
<p class="leise">„Schlüssel findet Schatten“: Anteil der Partien, in denen der Schlüsselträger den Schatten nachts geprüft hat; „danach Schüler-Sieg“ bezieht sich nur auf diese Partien. „Abstimmung ohne Keller“: Anteil der Abstimmungen, nach denen niemand eingesperrt wurde.</p>
${l.vergleich.length ? `
<h2>Vergleich mit der Basis</h2>
<div class="karte">
${vergleich}
</div>
<p class="leise">Ein Unterschied gilt nur als belegt, wenn sich die beiden 95-%-Intervalle nicht überlappen. Das ist vorsichtig: Kleine echte Unterschiede bleiben „nicht belegt“, bis mehr Partien gespielt sind. Bei vielen Varianten kann trotzdem einmal ein Zufallstreffer dabei sein.</p>` : ''}
${strategien}

<h2>Zum Nachstellen</h2>
<div class="karte">
${nachstellen}
</div>
<p>Standardregeln: <code>${maskiere(JSON.stringify(STANDARD_REGELN))}</code></p>
<p>Diese Liste als Datei speichern und mit <code>node tools/labor.mjs --partien ${l.partien} --startwert ${l.startwert} --varianten datei.json</code> erneut laufen lassen:</p>
<div class="karte"><pre>${maskiere(datei)}</pre></div>

<h2>Was die Zahlen nicht sagen</h2>
<p class="leise">Gespielt haben Skript-Gehirne mit festen Strategien. Claude-Figuren reden mehr und lügen besser; die Quoten sind ein Maß für das Gleichgewicht der Regeln, keine Vorhersage für echte Partien.</p>
</main>
</body>
</html>
`
}

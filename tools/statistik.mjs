// Partien-Statistik im Terminal: npm run statistik
// Liest partien.jsonl aus dem Datenordner (siehe spiel/ordner.mjs) und druckt Siege nach Rolle.
// Kostet nichts, ruft nichts im Netz auf.

import path from 'node:path'
import { partienSpeicher } from '../spiel/partienspeicher.mjs'
import { auswerten, bilanzSatz, ROLLEN_REIHE } from '../spiel/statistik.mjs'

const ALS = { schueler: 'Schüler', schluessel: 'Schlüsselträger', petze: 'Petze', schatten: 'Schatten' }
const prozent = (x) => `${Math.round(x * 100)} %`

// Tabelle als Text (rein, fuer Tests)
export function tabelle(a) {
  if (!a.partien) return 'Noch keine Partie gezählt. Nach jeder Partie, in der du mitspielst, kommt eine Zeile dazu.'
  const zeilen = [['Rolle', 'Partien', 'Siege', 'Quote']]
  for (const r of ROLLEN_REIHE) {
    const x = a.nachRolle[r]
    if (x.partien) zeilen.push([ALS[r], String(x.partien), String(x.siege), prozent(x.siege / x.partien)])
  }
  zeilen.push(['Gesamt', String(a.partien), String(a.siege), prozent(a.quote)])
  const breite = zeilen[0].map((_, i) => Math.max(...zeilen.map((z) => z[i].length)))
  const text = zeilen.map((z) => z.map((t, i) => (i === 0 ? t.padEnd(breite[i]) : t.padStart(breite[i]))).join('  '))
  text.splice(1, 0, breite.map((b) => '-'.repeat(b)).join('  '))
  text.push('')
  text.push(bilanzSatz(a))
  text.push(`Längste Siegesserie: ${a.besteSerie}, im Schnitt ${a.naechteSchnitt.toFixed(1).replace('.', ',')} Nächte pro Partie.`)
  if (a.gegner) text.push(`Häufigster Gegner: ${a.gegner.name} (${a.gegner.stimmen} Stimmen gegen dich).`)
  return text.join('\n')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const speicher = partienSpeicher()
  console.log(tabelle(auswerten(speicher.lesen())))
}

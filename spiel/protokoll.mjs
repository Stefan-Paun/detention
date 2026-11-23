// Partie-Protokoll als Markdown: zum Nachlesen, Teilen oder fuer Fehlerberichte.
// Reine Funktion ohne node:-Importe (laeuft auch in der Browser-Demo). Sie liest nur die Partie selbst:
// keine Hefte, keine Figurenbeschreibungen, keine Umgebung. Aufgenommen wird nur, was alle gesehen haben
// oder was am Ende ohnehin aufgedeckt wird (Rollen, Plaetze, Opfer, wer im Dunkeln sprach).
// Private Ereignisse (Beobachtungen, Pruefungen, Petze-Wahl, Untersuchungsergebnisse, geheime Zettel) fehlen.

import { bei, KLASSENBUCH } from './welt.mjs'
import { DUNKLE_STIMME } from './partie.mjs'

const ROLLE = { schatten: 'der Schatten', schluessel: 'der Schlüsselträger', petze: 'die Petze', schueler: 'ein normaler Schüler' }
const SIEGER = { schueler: 'Die Schüler', schatten: 'Der Schatten' }

// Spielertexte auf eine Zeile bringen und Markdown-Steuerzeichen am Zeilenanfang entschaerfen
const zeile = (t) => String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
const fett = (t) => `**${zeile(t).replace(/\*/g, '')}**`

// startwert: Zufallsstartwert der Partie (oder null, wenn unbekannt)
export function protokollText(p, { startwert = null } = {}) {
  const schatten = Object.keys(p.rollen).find((n) => p.rollen[n] === 'schatten')
  const wer = (n) => (n === p.spieler ? `${n} (Mensch)` : n)
  const z = []
  z.push('# Nachsitzen – Protokoll', '')
  if (startwert != null) z.push(`- Startwert: ${startwert} (nachspielbar mit \`node tools/simuliere.mjs 1 ${startwert}\`, wenn nur Skript-Figuren in der Standardbesetzung spielten)`)
  z.push(`- Im Raum: ${p.namen.map(wer).join(', ')}`)
  z.push(`- Nächte: ${p.nacht}`)
  z.push(`- Ausgang: ${p.sieger ? `${SIEGER[p.sieger]} ${p.sieger === 'schatten' ? 'hat' : 'haben'} gewonnen` : 'abgebrochen'}${schatten ? `. Der Schatten war ${schatten}.` : ''}`)
  z.push('', '## Rollen', '')
  for (const n of p.namen) z.push(`- ${wer(n)}: ${ROLLE[p.rollen[n]] ?? p.rollen[n]}`)

  // Wer sprach im Dunkeln? (wird am Ende ohnehin aufgedeckt)
  const imDunkeln = new Map()
  for (const e of p.ereignisse) if (e.art === 'im-dunkeln') imDunkeln.set(e.sagt, e.wer)

  const alle = p.namen.length
  for (const e of p.ereignisse) {
    const oeffentlich = e.sichtbar.length > 1 || alle <= 1
    switch (e.art) {
      case 'start': z.push('', '## Abend', '', `- ${zeile(e.text)}`); break
      case 'nacht': {
        z.push('', `## Nacht ${e.nacht}`, '')
        const n = p.naechte.find((x) => x.nacht === e.nacht)
        if (n) {
          z.push(`- Plätze: ${Object.entries(n.plaetze).map(([k, o]) => `${k} ${bei(o)}`).join(', ')}`)
          z.push(`- ${n.schatten} schleicht zu ${n.opfer}${n.verwischt ? ' und verwischt die Spur' : ''}.`)
        }
        break
      }
      case 'verschwunden': z.push('', `## Tag ${e.nacht}`, '', `- ${zeile(e.text)}`); break
      case 'fund': z.push(`- Fund: ${zeile(e.text)}`); break
      case 'zettel': z.push(`- Zettel unter der Tür: „${zeile(e.text)}“`); break
      case 'hausmeister': case 'glocke': case 'stromausfall': case 'licht': z.push(`- ${zeile(e.text)}`); break
      case 'diskussion': z.push(`- _Gesprächsrunde ${e.runde}${e.von ? ` von ${e.von}` : ''}_`); break
      case 'untersucht': z.push(`- ${e.von} untersucht ${e.ort === KLASSENBUCH ? 'das Klassenbuch' : `den Platz ${bei(e.ort)}`}.`); break
      case 'beweis': z.push(`- Beweis von ${e.von} (vom Spiel geprüft): ${zeile(e.text)}`); break
      case 'sagt':
        if (!oeffentlich) break
        if (e.dunkel || e.von === DUNKLE_STIMME) z.push(`- ${fett(DUNKLE_STIMME)}${imDunkeln.has(e.nr) ? ` (war ${imDunkeln.get(e.nr)})` : ''}: ${zeile(e.text)}`)
        else z.push(`- ${fett(e.von)}${e.an ? ` (zu ${e.an})` : ''}: ${zeile(e.text)}`)
        break
      case 'schweigt': if (oeffentlich) z.push(`- _${e.von} schweigt._`); break
      case 'abstimmung': z.push(`- _${zeile(e.text)}_`); break
      case 'stimme': if (oeffentlich) z.push(`- ${e.von} stimmt ${e.fuer ? `für ${e.fuer}` : 'für niemanden'}.`); break
      case 'zettelwahl': z.push(`- Zettel aufgedeckt: ${Object.entries(e.stimmen).map(([v, f]) => `${v} → ${f ?? 'niemand'}`).join(', ')}`); break
      case 'eingesperrt': z.push(`- ${fett(`${e.name} kommt in den Keller`)} (war ${ROLLE[e.rolle] ?? e.rolle}${e.los ? ', per Los' : ''}).`); break
      case 'niemand': z.push(`- Niemand kommt in den Keller${e.gleichstand ? ' (Gleichstand)' : ''}.`); break
      case 'ende': z.push('', '## Ende', '', `- ${SIEGER[e.sieger] ?? 'Niemand'} ${e.sieger === 'schatten' ? 'hat' : 'haben'} gewonnen. Der Schatten war ${e.schatten}.`); break
      default: break   // rolle, platz, schatten-waehlt, pruefung, petze-prueft, beobachtung, ergebnis, im-dunkeln, wahrheit: privat oder schon oben
    }
  }
  return z.join('\n') + '\n'
}

// Spielername pruefen: gilt fuer den Server und fuer die Browser-Demo (public/lokal.js).
// Keine node:-Importe, damit der Browser die Datei laden kann.

import { ORT_NAMEN, KLASSENBUCH } from './welt.mjs'

export const ZUSCHAUER_ERSATZ = 'Ben'   // nimmt den Platz des Menschen ein, wenn nur zugeschaut wird
export const KI_FIGUREN = ['Mira', 'Jonas', 'Lea', 'Tarik', 'Nora', 'Sam']

// Spielername: 1-20 Zeichen ohne Steuerzeichen und <>, kein Wort, das im Spiel schon etwas bedeutet.
// Leer ist erlaubt (Standardname „Du“); gibt den bereinigten Namen zurück oder wirft.
export function pruefeName(roh) {
  const name = String(roh ?? '').replace(/\s+/g, ' ').trim()
  if (!name) return 'Du'
  if (name.length > 20) throw new Error('Der Name darf höchstens 20 Zeichen lang sein')
  if (/[\p{Cc}\p{Cf}<>]/u.test(name)) throw new Error('Der Name enthält unerlaubte Zeichen (<, > oder Steuerzeichen)')
  const reserviert = ['niemand', 'alle', 'du', ZUSCHAUER_ERSATZ, KLASSENBUCH, ...ORT_NAMEN].map((w) => w.toLowerCase())
  if (reserviert.includes(name.toLowerCase())) throw new Error(`Der Name „${name}“ ist im Spiel schon belegt – wähle einen anderen`)
  return name
}

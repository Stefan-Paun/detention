// Die Regeln als ein Objekt. STANDARD_REGELN ist das Spiel, wie es heute gespielt wird; Server und
// Claude-Gehirne nutzen nur diesen Standard. Abweichungen sind fuer das Balance-Labor gedacht
// (tools/labor.mjs): dort laufen Varianten in tausenden Skript-Partien gegeneinander.
// Dieses Modul importiert nichts, damit partie.mjs und rollen.mjs ihre Konstanten von hier nehmen koennen.

export const GLEICHSTAND = ['niemand', 'stichwahl', 'los']

export const STANDARD_REGELN = Object.freeze({
  petze: null,             // null = ab `petzeAb` Figuren, true/false erzwingt die Rolle an/aus
  petzeAb: 7,              // ab so vielen Figuren gibt es eine Petze (Messung: docs/balance-petze.md)
  petzeJede: 2,            // die Petze erfaehrt nur jede n-te Nacht etwas (1 = jede Nacht)
  sprechrunden: 2,         // Diskussionsrunden pro Tag (Hausmeister: 1)
  maxUntersuchungen: 3,    // pro Figur und Partie (sonst ist die Wahrheit zu billig)
  gleichstand: 'niemand',  // 'niemand' = keiner kommt in den Keller, 'stichwahl' = zweite Runde nur unter den Gleichen
                           // (wieder gleich: niemand), 'los' = der Zufall entscheidet unter den Gleichen
  schlussNacht: null,      // null = offen; n = ist der Schatten nach der Abstimmung von Nacht n noch frei, gewinnt er
  tagesereignisse: true,   // Zettel, Hausmeister, Glocke am Morgen
})

const ganz = (von, bis) => (w) => Number.isInteger(w) && w >= von && w <= bis
const PRUEFUNG = {
  petze: [(w) => w === null || typeof w === 'boolean', 'null, true oder false'],
  petzeAb: [ganz(4, 9), 'eine ganze Zahl von 4 bis 9'],
  petzeJede: [ganz(1, 10), 'eine ganze Zahl von 1 bis 10'],
  sprechrunden: [ganz(1, 5), 'eine ganze Zahl von 1 bis 5'],
  maxUntersuchungen: [ganz(0, 10), 'eine ganze Zahl von 0 bis 10'],
  gleichstand: [(w) => GLEICHSTAND.includes(w), GLEICHSTAND.join(', ')],
  schlussNacht: [(w) => w === null || ganz(1, 10)(w), 'null oder eine ganze Zahl von 1 bis 10'],
  tagesereignisse: [(w) => typeof w === 'boolean', 'true oder false'],
}

// Standard plus Abweichungen, geprueft und eingefroren. Unbekannte Schluessel und falsche Werte werfen
// (die Abweichungen koennen aus einer JSON-Datei kommen).
export function regelnMit(abweichung = {}) {
  if (abweichung === null || typeof abweichung !== 'object' || Array.isArray(abweichung)) throw new Error('Regeln müssen ein Objekt sein')
  const r = { ...STANDARD_REGELN }
  for (const [k, w] of Object.entries(abweichung)) {
    if (!Object.hasOwn(PRUEFUNG, k)) throw new Error(`Unbekannte Regel: ${String(k).slice(0, 40)}`)
    if (w === undefined) continue
    const [ok, erwartet] = PRUEFUNG[k]
    if (!ok(w)) throw new Error(`Regel "${k}" braucht ${erwartet}`)
    r[k] = w
  }
  return Object.freeze(r)
}

// Nur das, was vom Standard abweicht (fuer Berichte: "so stellst du es nach").
export function abweichungen(regeln) {
  return Object.fromEntries(Object.entries(regeln).filter(([k, w]) => STANDARD_REGELN[k] !== w))
}

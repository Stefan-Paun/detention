// Tempo und Pause beim Zuschauen: gilt fuer den Server und fuer die Browser-Demo (public/lokal.js).
// Keine node:-Importe. `sp` ist der Partie-Zustand des Spielleiters ({ zuschauen, tempo, pausiert, beendet }).
//
// Die Pause haelt die Partie an zwei Stellen an: in der Pause nach jedem Schritt (Schleife) und vor
// jedem Gehirn-Aufruf der KI-Figuren. Waehrend sie gilt, startet also kein neuer (kostenpflichtiger) Aufruf;
// ein Aufruf, der schon laeuft, wird noch fertig.

// Faktor auf die Grundpause des Spielleiters (Server: 700 ms -> 1400 / 700 / 150)
export const TEMPO = { langsam: 2, normal: 1, schnell: 150 / 700 }
export const PAUSE_SCHRITT = 100   // ms zwischen zwei Blicken auf den Pause-Schalter

const schlafe = (ms) => new Promise((f) => setTimeout(f, ms))

// Wartezeit nach einem Schritt fuer die eingestellte Geschwindigkeit
export const tempoMs = (grund, tempo) => Math.round(grund * (TEMPO[tempo] ?? 1))

// Wartet, solange pausiert ist; bricht ab, sobald die Partie nicht mehr gebraucht wird.
export async function wartePause(sp, schritt = PAUSE_SCHRITT) {
  while (sp.pausiert && !sp.beendet) await schlafe(schritt)
}

// Pause-Funktion fuer spieleBisZumEnde: erst die Wartezeit, dann (falls angehalten) warten
export function tempoPause(sp, grund) {
  return async () => {
    await schlafe(tempoMs(grund, sp.tempo))   // auch bei 0 ms: einmal die Ereignisschleife freigeben (wie bisher)
    await wartePause(sp)
  }
}

// Gehirn einer KI-Figur so verpacken, dass jeder Aufruf erst nach der Pause startet.
// Nur Methoden, die die Schleife fuer Entscheidungen ruft; merke* und heftSchreiben bleiben unberuehrt.
const ENTSCHEIDUNGEN = ['abend', 'nacht', 'untersuchen', 'zeigen', 'diskussion', 'abstimmung']
export function mitBremse(g, sp) {
  const neu = { ...g }
  for (const m of ENTSCHEIDUNGEN) {
    if (typeof g[m] !== 'function') continue
    neu[m] = async (...a) => {
      await wartePause(sp)
      if (sp.beendet) throw new Error('Partie abgebrochen')
      return g[m](...a)
    }
  }
  return neu
}

// POST /aktion { art: 'tempo', wert } bzw. { art: 'pause', wert: true|false }.
// Gibt einen Fehlertext zurueck oder null; nur beim Zuschauen erlaubt.
export function tempoAktion(sp, { art, wert } = {}) {
  if (!sp) return 'Keine laufende Partie'
  if (!sp.zuschauen) return 'Tempo und Pause gibt es nur beim Zuschauen'
  if (art === 'tempo') {
    if (!Object.hasOwn(TEMPO, wert)) return `Tempo: ${Object.keys(TEMPO).join(', ')}`
    sp.tempo = wert
    return null
  }
  if (art === 'pause') {
    if (typeof wert !== 'boolean') return 'Pause: wert muss true oder false sein'
    sp.pausiert = wert
    return null
  }
  return 'Unbekannte Aktion'
}

export const istTempoAktion = (a) => a?.art === 'tempo' || a?.art === 'pause'

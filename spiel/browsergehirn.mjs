// Das Gehirn des Menschen im Browser: jede Entscheidung ist ein Versprechen, das der Server
// einloest, sobald die passende Aktion per POST /aktion ankommt. Ungueltige Aktionen werden
// hier abgewiesen, damit die Spielschleife nie an einer Mensch-Eingabe scheitert.
// LAN-Modus: `frist` (ms) beantwortet eine offene Frage nach Ablauf mit der Vorgabe (enthaelt sich,
// schweigt, Platz per Zufall); `sende` geht dann nur an das Geraet dieses Platzes.

import { SCHATTEN, SCHLUESSEL, PETZE } from './rollen.mjs'
import { behauptungAus } from './welt.mjs'

// Spielertext fuer den Verlauf: eine Zeile, ohne Steuerzeichen, ohne eckige Klammern (die sind im
// Prompt der Figuren fuer Spielmeldungen wie [BEWEIS ...] reserviert), hoechstens 300 Zeichen.
export function bereinigeText(roh) {
  return String(roh ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim().slice(0, 300)
}

// Antwort, wenn die Frist ablaeuft: niemand wird beschuldigt, niemand untersucht, Platz und Ziel per Zufall.
export function vorgabe(was, zahl = Math.random) {
  const aus = (liste) => liste[Math.floor(zahl() * liste.length)]
  switch (was.art) {
    case 'sagen': return was.pflicht ? { art: 'sagt', text: '…', an: null, behauptet: null } : { art: 'schweigt' }
    case 'nacht': return { platz: aus(was.orte), ziel: was.aufgabe === 'verstecken' ? undefined : aus(was.optionen), verwischen: false }
    case 'untersuchen': return null
    case 'zeigen': return false
    case 'stimme': return { fuer: null }
    default: return null
  }
}

export function browserGehirn(name, rolle, { sende, frist = null, zahl = Math.random } = {}) {
  let offen = null          // { was, loese, weise, wecker }

  const frage = (was) => new Promise((loese, weise) => {
    const w = frist ? { ...was, frist: Math.round(frist / 1000) } : was
    offen = { was: w, loese, weise, wecker: null, ende: frist ? Date.now() + frist : null }
    if (frist) {
      const meins = offen
      meins.wecker = setTimeout(() => {
        if (offen !== meins) return
        offen = null
        sende('warte', null)
        sende('frist', { text: 'Die Zeit ist um. Du enthältst dich diesmal.' })
        loese(vorgabe(w, zahl))
      }, frist)
    }
    sende('warte', w)
  })
  const andere = (lebende) => lebende.filter((n) => n !== name)

  return {
    name, rolle,
    abend: (sicht, lebende) => frage({ art: 'sagen', pflicht: true, andere: andere(lebende) }),
    diskussion: (sicht, lebende) => frage({ art: 'sagen', pflicht: false, andere: andere(lebende) }),
    nacht: (sicht, lebende, { orte, ziele, verwischen, petzeAktiv }) => frage({ art: 'nacht', aufgabe: rolle === SCHATTEN ? 'holen' : rolle === SCHLUESSEL ? 'pruefen' : rolle === PETZE && petzeAktiv !== false ? 'erfragen' : 'verstecken', orte, optionen: ziele ?? andere(lebende), verwischen: !!verwischen }),
    untersuchen: (sicht, lebende, { orte, uebrig }) => frage({ art: 'untersuchen', orte, uebrig }),
    zeigen: (sicht, lebende, { ergebnis }) => frage({ art: 'zeigen', ergebnis: ergebnis.text }),
    abstimmung: (sicht, lebende) => frage({ art: 'stimme', optionen: andere(lebende) }),
    merkePruefung() {},
    merkePetze() {},

    // Mit Frist: die Restzeit in Sekunden (wichtig nach dem Wiederverbinden)
    wartetAuf: () => (offen ? (offen.ende ? { ...offen.was, frist: Math.max(0, Math.round((offen.ende - Date.now()) / 1000)) } : offen.was) : null),

    // Liefert null bei Erfolg, sonst eine Fehlermeldung fuer den Browser.
    aktion(a) {
      if (!offen) return 'Gerade ist keine Eingabe gefragt'
      const { was } = offen
      let ergebnis
      if (was.art === 'sagen') {
        const text = bereinigeText(a.text)
        if (a.art === 'schweigt' || !text) {
          if (was.pflicht) return 'Sag zumindest einen Satz'
          ergebnis = { art: 'schweigt' }
        } else {
          if (a.an && !was.andere.includes(a.an)) return `${a.an} ist nicht im Raum. Ansprechen kannst du: ${was.andere.join(', ')} (oder niemanden)`
          ergebnis = { art: 'sagt', text, an: was.andere.includes(a.an) ? a.an : null, behauptet: behauptungAus(text) }
        }
      } else if (was.art === 'nacht') {
        if (!was.orte.includes(a.platz)) return `${a.platz ? `„${a.platz}“ ist kein Platz` : 'Du brauchst einen Platz'}. Plätze: ${was.orte.join(', ')}`
        if (was.aufgabe !== 'verstecken' && !was.optionen.includes(a.ziel)) return `${a.ziel ? `${a.ziel} kannst du heute nicht ${was.aufgabe === 'holen' ? 'holen' : was.aufgabe === 'erfragen' ? 'erfragen' : 'prüfen'}` : `Du musst auch sagen, ${was.aufgabe === 'erfragen' ? 'von wem du die Rolle erfahren willst' : `wen du ${was.aufgabe === 'holen' ? 'holst' : 'prüfst'}`}`}. Möglich: ${was.optionen.join(', ')}`
        ergebnis = { platz: a.platz, ziel: was.aufgabe === 'verstecken' ? undefined : a.ziel, verwischen: was.verwischen && !!a.verwischen }
      } else if (was.art === 'untersuchen') {
        if (a.ort != null && !was.orte.includes(a.ort)) return `„${a.ort}“ kannst du nicht untersuchen. Möglich: ${was.orte.join(', ')} oder nichts`
        ergebnis = a.ort ? { ort: a.ort } : null
      } else if (was.art === 'zeigen') {
        ergebnis = !!a.zeigen
      } else if (was.art === 'stimme') {
        if (a.fuer != null && !was.optionen.includes(a.fuer)) return `${a.fuer} steht nicht zur Wahl (nicht im Raum oder du selbst). Möglich: ${was.optionen.join(', ')} oder niemand`
        ergebnis = { fuer: a.fuer ?? null }
      } else return 'Unbekannte Eingabe'
      const { loese, wecker } = offen
      clearTimeout(wecker)
      offen = null
      sende('warte', null)
      loese(ergebnis)
      return null
    },

    abbrechen() {
      if (!offen) return
      const { weise, wecker } = offen
      clearTimeout(wecker)
      offen = null
      sende('warte', null)
      weise(new Error('Partie abgebrochen'))
    },
  }
}

// LAN-Modus (opt-in): zwei bis vier Menschen im selben WLAN, jeder am eigenen Geraet, die uebrigen
// Plaetze spielen KI-Figuren. Hier nur die reine Logik ohne HTTP: Beitrittscode, Sitzungs-Token,
// Drosselung, Lobby und der Platz, den der Gastgeber an die KI uebergeben kann. Der Server
// (server.mjs) haengt das an Routen unter /lan/.
//
// Sicherheit in Kurzform: Code 6 Zeichen aus crypto.randomInt, Token 32 Byte aus crypto.randomBytes.
// Beitritt nur mit Code und nur, solange die Lobby offen ist; Fehlversuche sind je Adresse und
// insgesamt gedrosselt. Jede Aktion wird gegen Token und Platz geprueft. Nur fuer das eigene WLAN.

import crypto from 'node:crypto'
import os from 'node:os'
import { pruefeName, KI_FIGUREN } from './name.mjs'

export const MAX_MENSCHEN = 4
export const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // ohne 0/O, 1/I: am Handy gut abzutippen
export const CODE_LAENGE = 6

export function neuerCode(zahl = crypto.randomInt) {
  let c = ''
  for (let i = 0; i < CODE_LAENGE; i++) c += CODE_ZEICHEN[zahl(CODE_ZEICHEN.length)]
  return c
}
export const neuesToken = () => crypto.randomBytes(32).toString('base64url')

// Vergleich in konstanter Zeit (gleich lange Puffer), damit Code und Token nicht Zeichen fuer Zeichen erraten werden
export function gleich(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// Eingetippten Code vereinheitlichen: Gross, ohne Leer- und Bindestriche
export const normalisiereCode = (roh) => String(roh ?? '').toUpperCase().replace(/[\s-]/g, '').slice(0, 20)

// Gleitendes Fenster: hoechstens `max` Ereignisse je Schluessel in `fensterMs`.
export function drossel({ max, fensterMs, jetzt = Date.now }) {
  const liste = new Map()   // schluessel -> Zeitpunkte
  const frisch = (k) => { const t = jetzt(); const l = (liste.get(k) ?? []).filter((x) => t - x < fensterMs); if (l.length) liste.set(k, l); else liste.delete(k); return l }
  return {
    voll: (k) => frisch(k).length >= max,
    zaehle: (k) => { const l = frisch(k); l.push(jetzt()); liste.set(k, l) },
    // zaehlt und sagt, ob es noch erlaubt war
    erlaubt(k) { const l = frisch(k); if (l.length >= max) return false; l.push(jetzt()); liste.set(k, l); return true },
    groesse: () => liste.size,
  }
}

const fehler = (text, status = 400) => Object.assign(new Error(text), { status })

// Die Lobby vor einer LAN-Partie. `lokal` = Anfrage kam ueber 127.0.0.1 (der Gastgeber am Rechner):
// er braucht keinen Code. Der Code wechselt bei jedem Oeffnen.
export function lanLobby({ maxMenschen = MAX_MENSCHEN, jetzt = Date.now, code: festerCode = null } = {}) {
  let code = festerCode ?? neuerCode()
  let offen = true
  const plaetze = []        // { name, token, bereit, gastgeber }
  const fehlProAdresse = drossel({ max: 5, fensterMs: 60_000, jetzt })
  const fehlGesamt = drossel({ max: 20, fensterMs: 60_000, jetzt })

  const sitzVon = (token) => (token ? plaetze.find((p) => gleich(p.token, token)) ?? null : null)

  return {
    get code() { return code },
    get offen() { return offen },
    get plaetze() { return plaetze },
    sitzVon,

    beitreten({ code: eingabe, name, adresse = '?', lokal = false }) {
      if (!lokal) {
        if (fehlProAdresse.voll(adresse) || fehlGesamt.voll('*')) throw fehler('Zu viele Fehlversuche. Warte eine Minute.', 429)
        if (!gleich(normalisiereCode(eingabe), code)) { fehlProAdresse.zaehle(adresse); fehlGesamt.zaehle('*'); throw fehler('Der Code stimmt nicht.', 403) }
      }
      if (!offen) throw fehler('Die Partie läuft schon. Beitreten geht nur in der Lobby.', 409)
      if (plaetze.length >= maxMenschen) throw fehler(`Es sind schon ${maxMenschen} Menschen dabei.`, 409)
      if (!String(name ?? '').trim()) throw fehler('Gib einen Namen ein.')
      const n = pruefeName(name)
      if (KI_FIGUREN.some((k) => k.toLowerCase() === n.toLowerCase())) throw fehler(`„${n}“ ist schon eine Figur im Spiel. Wähle einen anderen Namen.`)
      if (plaetze.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw fehler(`Den Namen „${n}“ hat schon jemand.`)
      const platz = { name: n, token: neuesToken(), bereit: false, gastgeber: !!lokal }
      plaetze.push(platz)
      return { name: n, token: platz.token }
    },

    bereit(token, wert) { const p = sitzVon(token); if (!p) throw fehler('Unbekannter Platz', 403); if (offen) p.bereit = !!wert; return p },

    entfernen(name) { const i = plaetze.findIndex((p) => p.name === name); if (i < 0) return false; plaetze.splice(i, 1); return true },

    // Fuer Gaeste: Namen und bereit, nie Token oder Code
    liste: () => plaetze.map((p) => ({ name: p.name, bereit: p.bereit, gastgeber: p.gastgeber })),

    schliessen() { offen = false },
    // Neue Runde nach einer Partie: neuer Code, alle wieder "nicht bereit", Plaetze bleiben
    oeffnen() { offen = true; code = festerCode ?? neuerCode(); for (const p of plaetze) p.bereit = false },
  }
}

// Ein menschlicher Platz, der waehrend der Partie an eine KI uebergeben werden kann. Die Spielschleife
// sieht immer dasselbe Gehirn; ruft sie gerade beim Menschen an, wird die offene Frage abgebrochen und
// dieselbe Frage an das neue Gehirn gestellt.
export function sitzGehirn(start) {
  let aktuell = start
  const weiter = (m) => async (...a) => {
    for (;;) {
      const g = aktuell
      if (!g[m]) return undefined
      try { return await g[m](...a) } catch (f) { if (g !== aktuell) continue; throw f }
    }
  }
  return {
    abend: weiter('abend'), nacht: weiter('nacht'), diskussion: weiter('diskussion'),
    untersuchen: weiter('untersuchen'), zeigen: weiter('zeigen'), abstimmung: weiter('abstimmung'),
    merkePruefung: (...a) => aktuell.merkePruefung?.(...a),
    merkePetze: (...a) => aktuell.merkePetze?.(...a),
    get aktuell() { return aktuell },
    uebergeben(neu) { const alt = aktuell; aktuell = neu; alt.abbrechen?.() },
  }
}

// Figur fuer einen Platz, den die KI uebernimmt: neutral, ohne Bezug zu den mitgelieferten Figuren
export function ersatzFigur(name) {
  return {
    name, alter: 17,
    beschreibung: 'Du bist neu in der Klasse und hast den Platz eines Mitschülers übernommen, der gehen musste. Ruhig, aufmerksam, du sagst, was du gesehen hast, und fragst nach, wenn etwas nicht zusammenpasst.',
    stil: 'Kurz und sachlich, freundlich, keine Sprüche.',
    beispiele: ['Ich hab das nicht gesehen, aber wer stand denn bei der Tür?', 'Das passt nicht zu dem, was du gestern gesagt hast.'],
    aussehen: { haut: '#e0b48f', haar: '#4a3326', frisur: 'kurz', shirt: '#5c6b8a' },
  }
}

// Erste private IPv4-Adresse (WLAN/LAN) oder null. Nie 0.0.0.0: wir binden nur, wo wir es sagen.
export function lanAdresse(netze = os.networkInterfaces()) {
  const privat = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
  for (const liste of Object.values(netze)) for (const n of liste ?? []) if ((n.family === 'IPv4' || n.family === 4) && !n.internal && privat(n.address)) return n.address
  return null
}

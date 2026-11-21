// Nachsitzen im Browser: kleiner Server auf 127.0.0.1, der eine Partie faehrt und den Browser
// per Server-Sent Events fuettert. Der API-Schluessel bleibt hier, der Browser sieht ihn nie.
//   node server.mjs            http://localhost:4800
//   NACHSITZEN_PORT=4801 node server.mjs
//   node server.mjs --lan      zusaetzlich im eigenen WLAN: bis zu 4 Menschen mit Beitrittscode (siehe README)

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zufall } from './spiel/zufall.mjs'
import * as P from './spiel/partie.mjs'
import { spieleBisZumEnde } from './spiel/schleife.mjs'
import { claudeGehirn, ladeFigur } from './spiel/gehirn.mjs'
import { browserGehirn } from './spiel/browsergehirn.mjs'
import { claudeAnfrage } from './spiel/claude.mjs'
import { apiSchluessel } from './spiel/schluessel.mjs'
import { kostenRechner, deckelAusUmgebung } from './spiel/kosten.mjs'
import { ORT_NAMEN, KLASSENBUCH } from './spiel/welt.mjs'
import { hefteSpeicher } from './spiel/hefte.mjs'
import { figurenSpeicher } from './spiel/figurenspeicher.mjs'
import { pruefeFigur, kennung, MAX_EIGENE, GRENZEN } from './spiel/figurenschema.mjs'
import { browserModule } from './tools/seite.mjs'
import { lanLobby, sitzGehirn, ersatzFigur, lanAdresse, drossel, MAX_MENSCHEN } from './spiel/lan.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
let browserDateien = null   // Set der Module aus spiel/, die der Browser laden darf (tools/seite.mjs)
const OEFFENTLICH = path.join(HIER, 'public')
import { pruefeName, KI_FIGUREN, ZUSCHAUER_ERSATZ } from './spiel/name.mjs'
export { pruefeName, KI_FIGUREN }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

// Port aus der Umgebung: leer -> 4800, sonst ganze Zahl 0-65535, alles andere wirft eine deutsche Meldung.
export function pruefePort(wert) {
  if (wert === undefined || wert === null || String(wert).trim() === '') return 4800
  const n = Number(wert)
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`Ungültiger Port „${wert}“ – NACHSITZEN_PORT muss eine Zahl von 0 bis 65535 sein`)
  return n
}

export const MAX_KI = 7, MIN_KI = 3   // plus Mensch oder Ben: 4 bis 8 Figuren wie in rollen.mjs
const MAX_FIGUREN_KOERPER = 8_000       // Bytes fuer Routen unter /figuren
const MAX_LAN_KOERPER = 2_000           // Bytes fuer Routen unter /lan
const LAN_FRIST = 90_000                // ms je Entscheidung im LAN-Modus, danach enthaelt sich der Platz
const LAN_HEMDEN = ['#bd93f9', '#8be9fd', '#ffb86c', '#50fa7b']   // Shirtfarben der Menschen im LAN-Modus

// Herkunftspruefung fuer die Figuren-Routen (zusaetzlich zur Host-Pruefung): Ein Browser schickt bei
// fremden Seiten Origin bzw. Sec-Fetch-Site mit; Skripte (curl, Tests) schicken oft keins von beiden.
export function herkunftOk(headers) {
  const o = headers.origin
  if (o !== undefined && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return false
  const site = headers['sec-fetch-site']
  return site === undefined || site === 'same-origin' || site === 'none'
}

// gehirnFabrik(name, rolle, { mitspieler, spieler, zufall, figur }) -> Gehirn; im Test Skript-Gehirne statt Claude
// figuren: Speicher fuer eigene Figuren (figurenSpeicher) oder null = Editor und eigene Figuren aus
// lan: null (Standard: nur 127.0.0.1) oder { adresse?, port?, frist?, code? } = zusaetzlich an die LAN-Adresse binden
export function erstelleServer({ gehirnFabrik, hefte = null, figuren: eigene = null, host = '127.0.0.1', port = pruefePort(process.env.NACHSITZEN_PORT), pause = 700, startwert = null, log = console.log, lan = null } = {}) {
  const verbindungen = new Map()   // res -> { lan, sitz }: lan = Geraet aus dem LAN-Modus (Sicht nur ueber seinen Platz)
  let spiel = null          // { p, spieler, zuschauen, mensch, lan, menschen, gesendet }
  let partien = 0           // zaehlt die Partien; Teil der SSE-id, damit alte Nummern nicht zur neuen Partie passen
  const lobby = lan ? lanLobby({ code: lan.code ?? null }) : null
  const lanFrist = lan?.frist ?? LAN_FRIST
  const lanRaten = drossel({ max: lan?.raten ?? 30, fensterMs: 10_000 })   // Anfragen je Platz (Token) in 10 s
  let lanZiel = null        // { adresse, port } sobald der LAN-Server lauscht

  // Eine SSE-Zeile; Spielereignisse tragen ihre Nummer als `id:`, damit der Browser sie bei der
  // automatischen Wiederverbindung als Last-Event-ID zurueckschickt.
  const sseZeile = (art, daten, id = null) => `${id === null ? '' : `id: ${id}\n`}event: ${art}\ndata: ${JSON.stringify(daten)}\n\n`
  const schreibe = (res, zeile) => { if (res.writableEnded) verbindungen.delete(res); else res.write(zeile) }
  // Allgemeine Meldungen (tippt, deckel, hefte, warte der Einzelpartie): LAN-Geraete nur in einer LAN-Partie
  const sende = (art, daten) => {
    const zeile = sseZeile(art, daten)
    for (const [res, v] of verbindungen) if (!v.lan || spiel?.lan) schreibe(res, zeile)
  }
  // Nur an die Geraete eines Platzes (LAN: warte und frist gehen nie an andere)
  const sendeAn = (sitz, art, daten) => { const zeile = sseZeile(art, daten); for (const [res, v] of verbindungen) if (v.sitz === sitz && v.lan) schreibe(res, zeile) }
  const sendeEreignis = (e) => { for (const [res, v] of verbindungen) if (darfSehen(v, e)) schreibe(res, sseZeile('ereignis', fuerBrowser(e), `${spiel.kennung}-${e.nr}`)) }
  const sendeStatus = () => { for (const [res, v] of verbindungen) schreibe(res, sseZeile('status', status(v))) }
  let ping = null   // Kommentarzeile alle 25 s, damit Proxys und Browser die Leitung nicht kappen
  const LOKAL = { lan: false, sitz: null }
  // Platz eines LAN-Geraets in der laufenden LAN-Partie (null: kein Mensch mehr, z. B. an die KI uebergeben)
  const lanSitz = (v) => (v.lan && spiel?.lan && v.sitz && spiel.menschen.has(v.sitz) ? v.sitz : null)
  // Was ein Geraet sehen darf. Einzelpartie: wie bisher (LAN-Geraete nichts). LAN-Partie: der eigene Platz
  // sieht seine Ereignisse; verschwunden oder ohne Platz (Rechner des Gastgebers) nur Oeffentliches,
  // also nie die privaten Nacht-Ereignisse anderer. Privat = genau eine Figur darf es sehen.
  function darfSehen(v, e) {
    if (!spiel.lan) return !v.lan && sichtbar(e)
    const sitz = lanSitz(v)
    if (v.lan && !sitz) return false
    if (sitz && e.sichtbar.includes(sitz)) return true
    return e.sichtbar.length > 1 && (!sitz || !spiel.p.lebende.includes(sitz))
  }
  const status = (v = LOKAL) => {
    if (!spiel) return null
    if (spiel.lan) return lanStatus(v)
    if (v.lan) return null   // Einzelpartie am Rechner: LAN-Geraete sehen nichts davon
    return einzelStatus()
  }
  function lanStatus(v) {
    const p = spiel.p, sitz = lanSitz(v)
    return {
      phase: p.phase, nacht: p.nacht, runde: p.runde, lebende: p.lebende, keller: p.keller, verschwunden: p.verschwunden,
      spieler: sitz, zuschauen: false, sieger: p.sieger, rolle: sitz ? p.rollen[sitz] : null, rollen: p.phase === 'ende' ? p.rollen : null,
      figuren: spiel.figuren, warte: sitz ? spiel.menschen.get(sitz).aktuell.wartetAuf?.() ?? null : null, orte: ORT_NAMEN, klassenbuch: KLASSENBUCH,
      hefte: false, hefteGeschrieben: false, geist: !!sitz && !p.lebende.includes(sitz), untersuchungenUebrig: sitz ? P.untersuchungenUebrig(p, sitz) : null,
      lan: { menschen: [...spiel.menschen.keys()], frist: Math.round(lanFrist / 1000) },
    }
  }
  const einzelStatus = () => spiel && {
    phase: spiel.p.phase, nacht: spiel.p.nacht, runde: spiel.p.runde, lebende: spiel.p.lebende, keller: spiel.p.keller,
    verschwunden: spiel.p.verschwunden, spieler: spiel.spieler, zuschauen: spiel.zuschauen, sieger: spiel.p.sieger,
    rolle: spiel.spieler ? spiel.p.rollen[spiel.spieler] : null,
    rollen: spiel.zuschauen || spiel.p.phase === 'ende' ? spiel.p.rollen : null,
    figuren: spiel.figuren, warte: spiel.mensch?.wartetAuf() ?? null, orte: ORT_NAMEN, klassenbuch: KLASSENBUCH, hefte: !!hefte, hefteGeschrieben: spiel.hefteGeschrieben,
    geist: !!spiel.spieler && !spiel.p.lebende.includes(spiel.spieler), untersuchungenUebrig: spiel.spieler ? P.untersuchungenUebrig(spiel.p, spiel.spieler) : null,
  }
  // Zuschauer sehen alles. Der Spieler sieht, was seine Figur sehen darf; ist er verschwunden
  // oder im Keller, schaut er als Geist weiter zu (alles ausser privaten Nacht-Ereignissen).
  // Als Geist (verschwunden oder im Keller) sieht der Spieler alles, auch die Nacht der anderen.
  const sichtbar = (e) => spiel.zuschauen || e.sichtbar.includes(spiel.spieler) || !spiel.p.lebende.includes(spiel.spieler)
  const fuerBrowser = (e) => { const { sichtbar: _, ...rest } = e; return rest }

  // Besetzung (KI-Figuren) aufloesen: Namen -> Figurendaten. Ohne Angabe die sechs mitgelieferten.
  function besetzen(wunsch) {
    if (wunsch === undefined || wunsch === null) return KI_FIGUREN.map((n) => ladeFigur(n))
    if (!Array.isArray(wunsch) || wunsch.some((n) => typeof n !== 'string')) throw new Error('Die Besetzung muss eine Liste von Namen sein')
    if (wunsch.length < MIN_KI || wunsch.length > MAX_KI) throw new Error(`Wähle ${MIN_KI} bis ${MAX_KI} Figuren (dazu kommst du oder Ben: 4 bis 8 im Raum)`)
    const gesehen = new Set()
    return wunsch.map((n) => {
      if (gesehen.has(n.toLowerCase())) throw new Error(`„${n.slice(0, 20)}“ ist doppelt gewählt`)
      gesehen.add(n.toLowerCase())
      const eingebaut = KI_FIGUREN.find((k) => k.toLowerCase() === n.toLowerCase())
      if (eingebaut) return ladeFigur(eingebaut)
      const gefunden = eigene?.vonName(n)
      if (!gefunden) throw new Error(`Die Figur „${n.slice(0, 20)}“ gibt es nicht`)
      return gefunden
    })
  }

  // Alte Partie stoppen (Schleife, Tippen, offene Fragen) und die neue laufen lassen
  function laufen(meins, z) {
    const alt = spiel
    if (alt) { alt.beendet = true; if (alt.p.phase !== 'ende') alt.abbrechen() }
    if (alt?.lan && lobby && !lobby.offen) lobby.oeffnen()
    meins.kennung = ++partien
    spiel = meins
    const p = meins.p
    const beobachter = (e) => { if (meins.beendet) return; sendeEreignis(e); sendeStatus() }
    spieleBisZumEnde(p, meins.gehirne, { zufall: z, beobachter, abbruch: () => meins.beendet, pause: () => new Promise((f) => setTimeout(f, pause)) })
      .then(() => { if (meins.lan) { if (!meins.beendet) lobby.oeffnen() } else return hefteSchreiben(meins) })
      .catch((f) => {
        log(`Partie beendet: ${f.message}`)
        if (meins.beendet) return   // abgeloest durch eine neue Partie: nichts mehr senden
        if (p.phase !== 'ende') { p.phase = 'ende'; p.sieger = p.sieger || null }
        if (meins.lan && !lobby.offen) lobby.oeffnen()
        sendeStatus()
      })
  }

  // LAN-Partie aus der Lobby: alle menschlichen Plaetze plus KI-Figuren (Standard: zusammen 7, mindestens 3 KI).
  // Ohne Hefte: die enthalten Urteile ueber den Gastgeber und gehen nie an fremde Geraete.
  function neueLanPartie({ besetzung } = {}) {
    if (!lobby.offen) throw Object.assign(new Error('Es läuft schon eine LAN-Partie'), { status: 409 })
    const plaetze = lobby.plaetze
    if (!plaetze.length) throw new Error('Noch niemand ist beigetreten')
    if (plaetze.some((x) => !x.bereit)) throw new Error(`Noch nicht bereit: ${plaetze.filter((x) => !x.bereit).map((x) => x.name).join(', ')}`)
    const menschenNamen = plaetze.map((x) => x.name)
    const ki = besetzen(besetzung ?? KI_FIGUREN.slice(0, Math.max(MIN_KI, Math.min(KI_FIGUREN.length, 7 - menschenNamen.length))))
    const namen = [...ki.map((f) => f.name), ...menschenNamen]
    if (namen.length > 8) throw new Error(`Zu viele im Raum (${namen.length}); höchstens 8. Wähle weniger KI-Figuren.`)
    if (new Set(namen.map((n) => n.toLowerCase())).size !== namen.length) throw new Error('Ein Name ist doppelt (Mensch und Figur)')
    const z = zufall(startwert ?? Date.now())
    const p = P.neuePartie(namen, z, { menschen: menschenNamen })
    const datenVon = Object.fromEntries(ki.map((f) => [f.name, f]))
    const figuren = Object.fromEntries(namen.map((n) => {
      const i = menschenNamen.indexOf(n)
      return [n, i >= 0 ? { haut: '#f1cfb0', haar: '#2b2118', frisur: 'wuschel', shirt: LAN_HEMDEN[i % LAN_HEMDEN.length] } : datenVon[n].aussehen]
    }))
    const gehirne = {}, menschen = new Map()
    const meins = { p, spieler: null, zuschauen: false, mensch: null, lan: true, menschen, figuren, gehirne, hefteGeschrieben: false, beendet: false, z }
    meins.abbrechen = () => { for (const s of menschen.values()) s.aktuell.abbrechen?.() }
    for (const n of namen) {
      if (!menschenNamen.includes(n)) {
        gehirne[n] = mitTippen(gehirnFabrik(n, p.rollen[n], { mitspieler: namen, spieler: null, zufall: z, heft: '', figur: datenVon[n] }), n, meins)
      } else {
        const sitz = sitzGehirn(browserGehirn(n, p.rollen[n], { sende: (art, d) => { if (!meins.beendet) sendeAn(n, art, d) }, frist: lanFrist, zahl: z.zahl }))
        menschen.set(n, sitz); gehirne[n] = sitz
      }
    }
    lobby.schliessen()
    laufen(meins, z)
    return status()
  }

  // Gastgeber: Platz an die KI geben. In der Lobby heisst das nur: Platz freigeben.
  function uebergeben(name) {
    if (lobby.offen || !spiel?.lan || spiel.p.phase === 'ende') {
      if (!lobby.entfernen(name)) throw Object.assign(new Error(`„${String(name).slice(0, 20)}“ sitzt nicht in der Lobby`), { status: 404 })
      trennen(name); return { ok: true, lobby: true }
    }
    const sitz = spiel.menschen.get(name)
    if (!sitz) throw Object.assign(new Error(`„${String(name).slice(0, 20)}“ ist kein menschlicher Platz`), { status: 404 })
    const sp = spiel
    const ki = mitTippen(gehirnFabrik(name, sp.p.rollen[name], { mitspieler: sp.p.namen, spieler: null, zufall: sp.z, heft: '', figur: ersatzFigur(name) }), name, sp)
    sp.menschen.delete(name)
    lobby.entfernen(name)
    trennen(name)
    sitz.uebergeben(ki)
    sendeStatus()
    return { ok: true, lobby: false }
  }
  // Geraete eines Platzes trennen (Token gilt nicht mehr)
  function trennen(name) {
    for (const [res, v] of verbindungen) if (v.lan && v.sitz === name) { res.write(sseZeile('uebergeben', { text: 'Dein Platz ist frei: Der Gastgeber hat ihn an die KI gegeben oder aus der Lobby genommen.' })); res.end(); verbindungen.delete(res) }
  }

  function neuePartie({ name, zuschauen, besetzung }) {
    const spieler = zuschauen ? null : pruefeName(name)
    const ki = besetzen(besetzung)
    const namen = [...ki.map((f) => f.name), zuschauen ? ZUSCHAUER_ERSATZ : spieler]
    if (new Set(namen.map((n) => n.toLowerCase())).size !== namen.length) throw new Error('Der Name ist schon vergeben')
    const z = zufall(startwert ?? Date.now())
    const p = P.neuePartie(namen, z, { spieler })
    const datenVon = Object.fromEntries(ki.map((f) => [f.name, f]))
    const figuren = Object.fromEntries(namen.map((n) => [n, n === spieler ? { haut: '#f1cfb0', haar: '#2b2118', frisur: 'wuschel', shirt: '#bd93f9' } : (datenVon[n] ?? ladeFigur(n)).aussehen]))
    const gehirne = {}
    const meins = { p, spieler, zuschauen, mensch: null, lan: false, figuren: figuren, gehirne, hefteGeschrieben: false, beendet: false }
    meins.abbrechen = () => meins.mensch?.abbrechen()
    for (const n of namen) {
      if (n === spieler) { meins.mensch = browserGehirn(n, p.rollen[n], { sende }); gehirne[n] = meins.mensch }
      else {
        const g = gehirnFabrik(n, p.rollen[n], { mitspieler: namen, spieler, zufall: z, heft: hefte ? hefte.alsText(n) : '', figur: datenVon[n] ?? ladeFigur(n) })
        gehirne[n] = mitTippen(g, n, meins)
      }
    }
    laufen(meins, z)   // alte Partie stoppt (Schleife, Tippen, Hefte)
    return status()
  }

  // Nach dem Ende schreibt jede KI-Figur in ihr Heft (ein Aufruf pro Figur); der Browser bekommt die Eintraege.
  async function hefteSchreiben(sp) {
    if (!hefte || sp !== spiel) return
    const z = P.zusammenfassung(sp.p)
    const eintraege = {}
    for (const [n, g] of Object.entries(sp.gehirne)) {
      if (!g.heftSchreiben) continue
      if (sp !== spiel) return   // neue Partie gestartet: keine weiteren Heft-Aufrufe
      sende('tippt', { von: n })
      try {
        const e = await g.heftSchreiben(P.verlaufFuer(sp.p, n), z)
        if (sp !== spiel) return   // inzwischen neue Partie: Eintrag verwerfen, nichts senden
        hefte.schreiben(n, { ...e, rolle: sp.p.rollen[n], schatten: z.schatten, sieger: z.sieger, spieler: sp.spieler })
        eintraege[n] = e
      } catch (f) { log(`Heft ${n}: ${f.message}`) }
      if (sp !== spiel) return
      sende('tippt', { von: n, fertig: true })
    }
    sp.hefteGeschrieben = true
    sende('hefte', eintraege); sendeStatus()
  }

  // KI-Gehirne melden vorher "tippt", damit der Browser Leben zeigt
  function mitTippen(g, n, sp) {
    const melde = (daten) => { if (!sp.beendet) sende('tippt', daten) }
    const h = (fn) => async (...a) => { melde({ von: n }); try { return await fn(...a) } finally { melde({ von: n, fertig: true }) } }
    return { ...g, abend: h(g.abend), nacht: g.nacht, diskussion: h(g.diskussion), abstimmung: h(g.abstimmung) }
  }

  // SSE-Leitung oeffnen und alles nachliefern, was dieses Geraet sehen darf
  function oeffneStrom(req, res, v) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    verbindungen.set(res, v)
    req.on('close', () => verbindungen.delete(res))
    if (spiel) {
      // Last-Event-ID ("<partie>-<nr>"): nur Neueres nachliefern, aber nur aus derselben Partie.
      // Fremde Partie, Unsinn oder eine Nummer, die es noch nicht gibt, liefert alles.
      // Eine blanke Zahl (curl, Skripte) gilt fuer die laufende Partie.
      const m = /^(?:(\d+)-)?(\d+)$/.exec(req.headers['last-event-id'] ?? '')
      const gueltig = m && (m[1] === undefined || Number(m[1]) === spiel.kennung) && Number(m[2]) < spiel.p.ereignisse.length
      const letzte = gueltig ? Number(m[2]) : -1
      res.write(sseZeile('status', status(v)))   // zuerst, damit der Browser weiss, wer er ist
      for (const e of spiel.p.ereignisse) if (e.nr > letzte && darfSehen(v, e)) res.write(sseZeile('ereignis', fuerBrowser(e), `${spiel.kennung}-${e.nr}`))
      res.write(sseZeile('status', status(v)))
    } else res.write(sseZeile('status', null))
  }

  // Routen unter /lan. viaLan = Anfrage kam ueber die LAN-Adresse (Gast), sonst ueber 127.0.0.1 (Gastgeber).
  async function lanRoute(req, res, url, viaLan) {
    const antwort = (st, daten) => res.writeHead(st, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(daten))
    const pfad = url.pathname
    if (req.method === 'POST') {
      if (!/^application\/json(;|$)/i.test(req.headers['content-type'] || '')) { antwort(415, { ok: false, fehler: 'Nur application/json' }); return }
      if (!viaLan && !herkunftOk(req.headers)) { antwort(403, { ok: false, fehler: 'Fremde Herkunft' }); return }
    }
    // Token: Kopfzeile (fetch) oder ?token= (EventSource kann keine Kopfzeilen); POST nur per Kopfzeile
    const token = req.headers['x-nachsitzen-token'] || (req.method === 'GET' ? url.searchParams.get('token') : null)
    const platz = lobby.sitzVon(token)
    if (platz && !lanRaten.erlaubt(platz.token)) { antwort(429, { ok: false, fehler: 'Zu viele Anfragen. Kurz warten.' }); return }

    if (req.method === 'POST' && pfad === '/lan/beitreten') {
      const body = await lies(req, MAX_LAN_KOERPER)
      const r = lobby.beitreten({ code: body.code, name: body.name, adresse: req.socket.remoteAddress, lokal: !viaLan })
      sendeLobby()
      antwort(200, { ok: true, ...r })
      return
    }
    if (req.method === 'GET' && pfad === '/lan/lobby') {
      if (viaLan && !platz) { antwort(403, { ok: false, fehler: 'Unbekannter Platz. Tritt mit dem Code bei.' }); return }
      antwort(200, lobbyDaten(viaLan ? null : 'gastgeber', platz))
      return
    }
    if (req.method === 'POST' && (pfad === '/lan/start' || pfad === '/lan/uebergeben')) {
      if (viaLan) { res.writeHead(404).end('nicht gefunden'); return }
      const body = await lies(req, MAX_LAN_KOERPER)
      if (pfad === '/lan/start') { neueLanPartie(body); antwort(200, { ok: true }) }
      else antwort(200, uebergeben(body.name))
      sendeLobby()
      return
    }
    // Ab hier nur mit gueltigem Platz
    if (!platz) { antwort(403, { ok: false, fehler: 'Unbekannter Platz. Tritt mit dem Code bei.' }); return }
    if (req.method === 'POST' && pfad === '/lan/bereit') {
      const body = await lies(req, MAX_LAN_KOERPER)
      lobby.bereit(token, body.bereit !== false)
      sendeLobby()
      antwort(200, { ok: true })
      return
    }
    if (req.method === 'POST' && pfad === '/lan/aktion') {
      const body = await lies(req, MAX_LAN_KOERPER)
      const sitz = spiel?.lan && spiel.p.phase !== 'ende' ? spiel.menschen.get(platz.name) : null
      const fehler = sitz ? (sitz.aktuell.aktion ? sitz.aktuell.aktion(body) : 'Deinen Platz spielt jetzt die KI') : 'Keine laufende LAN-Partie'
      antwort(fehler ? 400 : 200, { ok: !fehler, fehler })
      return
    }
    if (req.method === 'GET' && pfad === '/lan/ereignisse') {
      // hoechstens 3 Leitungen je Platz (Handy, Tablet, neu geladen); die aelteste faellt weg
      const meine = [...verbindungen].filter(([, v]) => v.lan && v.sitz === platz.name)
      for (const [r] of meine.slice(0, Math.max(0, meine.length - 2))) { r.end(); verbindungen.delete(r) }
      oeffneStrom(req, res, { lan: true, sitz: platz.name })
      res.write(sseZeile('lobby', lobbyDaten(null, platz)))
      return
    }
    if (req.method === 'GET' && pfad === '/lan/verlauf') {
      const v = { lan: true, sitz: platz.name }
      const ab = Number(url.searchParams.get('ab') || 0)
      const liste = spiel ? spiel.p.ereignisse.filter((e) => e.nr >= ab && darfSehen(v, e)).map(fuerBrowser) : []
      antwort(200, { ereignisse: liste, status: status(v) })
      return
    }
    res.writeHead(404).end('nicht gefunden')
  }

  // Lobby fuer die Anzeige. Der Gastgeber am Rechner sieht Code und Adresse, Gaeste nie.
  function lobbyDaten(wer, platz) {
    const d = { offen: lobby.offen, plaetze: lobby.liste(), max: MAX_MENSCHEN, ich: platz?.name ?? null, laeuft: !!spiel?.lan && spiel.p.phase !== 'ende', frist: Math.round(lanFrist / 1000) }
    if (wer === 'gastgeber') Object.assign(d, { gastgeber: true, code: lobby.code, adresse: lanZiel ? `http://${lanZiel.adresse}:${lanZiel.port}/?lan=1` : null, menschen: spiel?.lan ? [...spiel.menschen.keys()] : [] })
    return d
  }
  const sendeLobby = () => { if (!lobby) return; for (const [res, v] of verbindungen) schreibe(res, sseZeile('lobby', v.lan ? lobbyDaten(null, lobby.plaetze.find((x) => x.name === v.sitz)) : lobbyDaten('gastgeber', null))) }

  async function behandle(req, res, viaLan) {
    const hostKopf = req.headers.host || ''
    const hostOk = viaLan
      ? lanZiel && new RegExp(`^${lanZiel.adresse.replace(/\./g, '\\.')}(:${lanZiel.port})?$`).test(hostKopf)
      : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostKopf)
    if (!hostOk) { res.writeHead(403).end(viaLan ? 'falsche Adresse' : 'nur lokal'); return }
    const url = new URL(req.url, `http://${hostKopf}`)
    try {
      if (url.pathname.startsWith('/lan/')) {
        if (!lobby) { res.writeHead(404).end('nicht gefunden'); return }
        await lanRoute(req, res, url, viaLan)
        return
      }
      // Ueber die LAN-Adresse gibt es sonst nur die statische Seite und die Browser-Module (Liste, keine Ausnahmen):
      // Figuren, Hefte, Einzelpartie und Status bleiben auf diesem Rechner
      if (viaLan) {
        if (req.method !== 'GET') { res.writeHead(405).end(); return }
        if (url.pathname.startsWith('/spiel/')) browserModul(url, res); else statisch(url, res)
        return
      }
      if (url.pathname === '/figuren' || url.pathname.startsWith('/figuren/')) {
        if (!eigene) { res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, fehler: 'Eigene Figuren sind abgeschaltet' })); return }
        if (!herkunftOk(req.headers)) { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, fehler: 'Fremde Herkunft' })); return }
        const antwort = (status, daten) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(daten))
        const schreibend = req.method !== 'GET'
        if (schreibend && !/^application\/json(;|$)/i.test(req.headers['content-type'] || '')) { antwort(415, { ok: false, fehler: 'Nur application/json' }); return }
        const teile = url.pathname.split('/').slice(2)   // '' | ['pruefen'] | [kennung]
        if (teile.length > 1 || (teile.length === 1 && teile[0] === '')) { res.writeHead(404).end('nicht gefunden'); return }
        try {
          if (req.method === 'GET' && teile.length === 0) {
            const { figuren: liste, kaputt } = eigene.liste()
            antwort(200, { eigene: liste, kaputt, mitgeliefert: KI_FIGUREN.map((n) => ladeFigur(n)), max: MAX_EIGENE, grenzen: GRENZEN, besetzung: { min: MIN_KI, max: MAX_KI } })
          } else if (req.method === 'POST' && teile[0] === 'pruefen') {
            const body = await lies(req, MAX_FIGUREN_KOERPER)
            const r = pruefeFigur(body.figur)
            const k = r.ok ? kennung(r.figur.name) : ''
            antwort(200, { ok: r.ok, fehler: r.fehler, figur: r.figur, kennung: k, vorhanden: !!k && !!eigene.lesen(k) })
          } else if (req.method === 'POST' && teile.length === 0) {
            const body = await lies(req, MAX_FIGUREN_KOERPER)
            antwort(200, { ok: true, figur: eigene.anlegen(body.figur) })
          } else if (req.method === 'PUT' && teile.length === 1) {
            const body = await lies(req, MAX_FIGUREN_KOERPER)
            antwort(200, { ok: true, figur: eigene.ersetzen(teile[0], body.figur) })
          } else if (req.method === 'DELETE' && teile.length === 1) {
            antwort(200, { ok: true, papierkorb: eigene.loeschen(teile[0]) })
          } else res.writeHead(405).end()
        } catch (f) {
          antwort(f.status || 400, { ok: false, fehler: f.message, felder: f.fehler ?? [] })
        }
        return
      }
      if (req.method === 'GET' && url.pathname === '/ereignisse') {
        oeffneStrom(req, res, { lan: false, sitz: null })
        if (lobby) res.write(sseZeile('lobby', lobbyDaten('gastgeber', null)))
        return
      }
      if (req.method === 'POST' && url.pathname === '/partie') {
        const body = await lies(req)
        const neu = neuePartie(body)   // wirft bei ungueltigem Namen, bevor Kopfzeilen gesendet sind
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(neu))
        return
      }
      if (req.method === 'POST' && url.pathname === '/aktion') {
        const body = await lies(req)
        const fehler = spiel?.mensch ? spiel.mensch.aktion(body) : 'Keine laufende Partie'
        res.writeHead(fehler ? 400 : 200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: !fehler, fehler }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/hefte') {
        // Nur zwischen den Partien lesbar - waehrend des Spiels wuesste der Spieler sonst, wer ihm misstraut
        if (!hefte || (spiel && spiel.p.phase !== 'ende')) { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ fehler: 'Hefte gibt es erst nach der Partie' })); return }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(hefte.alle([...KI_FIGUREN, ZUSCHAUER_ERSATZ])))
        return
      }
      if (req.method === 'GET' && url.pathname === '/verlauf') {
        // Alle sichtbaren Ereignisse ab ?ab=<nr> als JSON (fuer Skripte und Tests ohne SSE)
        const ab = Number(url.searchParams.get('ab') || 0)
        const liste = spiel ? spiel.p.ereignisse.filter((e) => e.nr >= ab && darfSehen(LOKAL, e)).map(fuerBrowser) : []
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ereignisse: liste, status: status() }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(status()))
        return
      }
      if (req.method === 'GET' && url.pathname.startsWith('/spiel/')) { browserModul(url, res); return }
      if (req.method === 'GET') { statisch(url, res); return }
      res.writeHead(405).end()
    } catch (f) {
      if (res.headersSent) { res.end(); return }
      res.writeHead(f.status || 400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, fehler: f.message }))
    }
  }
  const server = http.createServer((req, res) => behandle(req, res, false))
  const lanServer = lan ? http.createServer((req, res) => behandle(req, res, true)) : null
  const lausche = (srv, p, h) => new Promise((f, w) => {
    srv.once('error', (fehler) => {
      if (fehler.code === 'EADDRINUSE') w(new Error(`Port ${p} ist belegt – starte mit NACHSITZEN_PORT=${p + 1} npm start`))
      else if (fehler.code === 'EACCES') w(new Error(`Keine Berechtigung für Port ${p} – wähle einen Port über 1024, z. B. NACHSITZEN_PORT=4801 npm start`))
      else if (fehler.code === 'EADDRNOTAVAIL') w(new Error(`Die Adresse ${h} gibt es auf diesem Rechner nicht`))
      else w(fehler)
    })
    srv.listen(p, h, () => f(srv.address().port))
  })

  return {
    server,
    melde: (art, daten) => sende(art, daten),
    starten: async () => {
      const lokalPort = await lausche(server, port, host)
      if (lanServer) {
        const adresse = lan.adresse ?? lanAdresse()
        if (!adresse) { server.close(); throw new Error('Keine WLAN-Adresse gefunden (192.168.x.x, 10.x.x.x oder 172.16-31.x.x). Ohne --lan läuft das Spiel nur auf diesem Rechner.') }
        try { lanZiel = { adresse, port: await lausche(lanServer, lan.port ?? lokalPort, adresse) } } catch (f) { server.close(); throw f }
      }
      clearInterval(ping)
      ping = setInterval(() => { for (const res of verbindungen.keys()) res.write(': ping\n\n') }, 25_000)
      ping.unref()
      return lokalPort
    },
    schliessen: () => new Promise((f) => {
      clearInterval(ping); for (const r of verbindungen.keys()) r.end(); if (spiel) { spiel.beendet = true; spiel.abbrechen?.() }
      let offen = lanServer?.listening ? 2 : 1
      const fertig = () => { if (--offen === 0) f() }
      server.close(fertig); if (lanServer?.listening) lanServer.close(fertig)
      server.closeAllConnections(); lanServer?.closeAllConnections()   // SSE-Leitungen nicht bis zum Keep-alive-Ende offen halten
    }),
    partie: () => spiel?.p ?? null,
    // LAN-Modus: { adresse, port, code } oder null
    lan: () => (lobby && lanZiel ? { ...lanZiel, code: lobby.code } : null),
  }
}

// Nur die Spielregeln, die die Browser-Demo (public/lokal.js, ?demo=1) importiert; nichts mit Dateien oder Schluesseln
function browserModul(url, res) {
  const rel = url.pathname.slice(1)
  if (!(browserDateien ??= new Set(browserModule())).has(rel)) { res.writeHead(404).end('nicht gefunden'); return }
  res.writeHead(200, { 'content-type': MIME['.js'] }).end(fs.readFileSync(path.join(HIER, rel)))
}
// Dateien aus public/, ohne Ausbruch aus dem Ordner
function statisch(url, res) {
  const datei = path.normalize(path.join(OEFFENTLICH, url.pathname === '/' ? 'index.html' : url.pathname))
  if (!datei.startsWith(OEFFENTLICH) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) { res.writeHead(404).end('nicht gefunden'); return }
  res.writeHead(200, { 'content-type': MIME[path.extname(datei)] || 'application/octet-stream' }).end(fs.readFileSync(datei))
}

// Koerper lesen, hoechstens `max` Bytes; zu gross -> Fehler mit Status 413 (der Rest wird verworfen)
function lies(req, max = 10_000) {
  return new Promise((f, w) => {
    const zuGross = () => Object.assign(new Error('zu gross'), { status: 413 })
    if (Number(req.headers['content-length'] || 0) > max) { req.resume(); w(zuGross()); return }
    const teile = []; let n = 0; let fertig = false
    req.on('data', (c) => { if (fertig) return; n += c.length; if (n > max) { fertig = true; w(zuGross()); req.resume(); return } teile.push(c) })
    req.on('end', () => {
      if (fertig) return
      const t = Buffer.concat(teile).toString('utf8')
      try { f(t ? JSON.parse(t) : {}) } catch { w(new Error('kein JSON')) }
    })
  })
}

// --- Start von der Kommandozeile: echte Claude-Gehirne ----------------------------------
// LAN-Modus nur mit Schalter: --lan oder NACHSITZEN_LAN=1 (Adresse notfalls per NACHSITZEN_LAN_ADRESSE)
export function lanAusStart(argv = process.argv, env = process.env) {
  if (!argv.includes('--lan') && env.NACHSITZEN_LAN !== '1') return null
  return { adresse: env.NACHSITZEN_LAN_ADRESSE || undefined }
}
function lanMelden(s) {
  const l = s.lan()
  if (!l) return
  console.log(`\n  LAN-Modus (nur im eigenen WLAN!): Mitspieler öffnen http://${l.adresse}:${l.port}/?lan=1`)
  console.log(`  Beitrittscode: ${l.code}   (höchstens 4 Menschen; Lobby und Start auf http://localhost:${s.server.address().port})\n`)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  try {
  const lan = lanAusStart()
  if (process.argv.includes('--skript')) {
    // Ohne KI und ohne Kosten: Skript-Gehirne, zum Entwickeln der Oberflaeche
    const { skriptGehirn } = await import('./tools/skriptgehirne.mjs')
    const s = erstelleServer({ gehirnFabrik: (name, rolle, { zufall: z }) => skriptGehirn(name, rolle, z), pause: 900, figuren: figurenSpeicher(), lan })
    console.log(`Nachsitzen (Skript-Modus, keine KI) laeuft auf http://localhost:${await s.starten()}`)
    lanMelden(s)
  } else {
  const deckel = deckelAusUmgebung()
  const kosten = kostenRechner({ deckel })
  console.log(`  Tagesdeckel: ${deckel} $ (NACHSITZEN_DECKEL)`)
  const anfrage = claudeAnfrage({ schluessel: apiSchluessel(), kosten, log: (m) => console.log(`  (${m})`) })
  let deckelGemeldet = false
  const fabrik = (name, rolle, opts) => claudeGehirn(opts.figur ?? ladeFigur(name), rolle, { anfrage, ...opts, log: (m) => {
    console.log(`  (${m})`)
    if (m.includes('Tagesdeckel') && !deckelGemeldet) { deckelGemeldet = true; s.melde('deckel', { text: 'Der Tagesdeckel für die KI-Aufrufe ist erreicht. Die Figuren schweigen ab jetzt, bis morgen (oder du erhöhst NACHSITZEN_DECKEL).' }) }
  } })
  const s = erstelleServer({ gehirnFabrik: fabrik, hefte: hefteSpeicher(), figuren: figurenSpeicher(), lan })
  const port = await s.starten()
  console.log(`Nachsitzen laeuft auf http://localhost:${port}`)
  lanMelden(s)
  const t = kosten.heute()
  if (t.aufrufe) console.log(`Heute bisher: ${t.aufrufe} Aufrufe, ${(t.dollar * 100).toFixed(1)} Cent`)
  }
  } catch (f) {
    console.error(f.message)
    process.exit(1)
  }
}

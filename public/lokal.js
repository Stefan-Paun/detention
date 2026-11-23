// Spielleiter im Browser: dieselbe Partie wie server.mjs, aber ohne Server, ohne Schluessel und ohne
// Netz. Die Mitschueler sind Skript-Figuren (spiel/skriptgehirne.mjs), keine KI. app.js nimmt das,
// wenn die Seite nicht auf localhost laeuft (GitHub Pages) oder mit ?demo=1 geoeffnet wird.
// Kein DOM hier: test/demo.test.mjs faehrt den Spielleiter in Node.

import { zufall } from '../spiel/zufall.mjs'
import * as P from '../spiel/partie.mjs'
import { spieleBisZumEnde } from '../spiel/schleife.mjs'
import { protokollText } from '../spiel/protokoll.mjs'
import { browserGehirn } from '../spiel/browsergehirn.mjs'
import { skriptGehirn } from '../spiel/skriptgehirne.mjs'
import { ORT_NAMEN, KLASSENBUCH } from '../spiel/welt.mjs'
import { pruefeName, KI_FIGUREN, ZUSCHAUER_ERSATZ } from '../spiel/name.mjs'
import { AUSSEHEN, SPIELER_AUSSEHEN } from '../spiel/demofiguren.mjs'

const schlafe = (ms) => new Promise((f) => setTimeout(f, ms))

// pause: Wartezeit nach jedem Schritt (ms); denkzeit: [min, max] fuer die "überlegt"-Anzeige der Figuren
export function lokalerSpielleiter({ pause = 900, denkzeit = [400, 1100], startwert = null } = {}) {
  const hoerer = new Map()        // art -> Set(fn)
  let spiel = null                // wie im Server: { p, spieler, zuschauen, mensch, figuren, beendet }
  const sende = (art, daten) => { for (const fn of hoerer.get(art) ?? []) fn(daten) }
  const meldeFuer = (sp) => (art, daten) => { if (!sp.beendet) sende(art, daten) }

  const status = () => spiel && {
    phase: spiel.p.phase, nacht: spiel.p.nacht, runde: spiel.p.runde, lebende: spiel.p.lebende, keller: spiel.p.keller,
    verschwunden: spiel.p.verschwunden, spieler: spiel.spieler, zuschauen: spiel.zuschauen, sieger: spiel.p.sieger,
    rolle: spiel.spieler ? spiel.p.rollen[spiel.spieler] : null,
    rollen: spiel.zuschauen || spiel.p.phase === 'ende' ? spiel.p.rollen : null,
    figuren: spiel.figuren, warte: spiel.mensch?.wartetAuf() ?? null, orte: ORT_NAMEN, klassenbuch: KLASSENBUCH, hefte: false, hefteGeschrieben: false,
    geist: !!spiel.spieler && !spiel.p.lebende.includes(spiel.spieler), untersuchungenUebrig: spiel.spieler ? P.untersuchungenUebrig(spiel.p, spiel.spieler) : null,
    demo: true,
  }
  // Wie im Server: Zuschauer und Geister sehen alles, der Spieler nur, was seine Figur sehen darf
  const sichtbar = (sp, e) => sp.zuschauen || e.sichtbar.includes(sp.spieler) || !sp.p.lebende.includes(sp.spieler)
  const fuerBrowser = (e) => { const { sichtbar: _, ...rest } = e; return rest }

  // Skript-Figuren antworten sofort; eine kurze Denkpause mit "überlegt" macht die Partie lesbar
  function mitTippen(g, n, sp) {
    const melde = meldeFuer(sp)
    const denken = () => (denkzeit[1] > 0 ? schlafe(denkzeit[0] + Math.random() * (denkzeit[1] - denkzeit[0])) : Promise.resolve())
    // Im Stromausfall verriete "X überlegt" den Sprecher (wie im Server)
    const tippt = (daten) => { if (sp.zuschauen || !P.imDunkeln(sp.p)) melde('tippt', daten) }
    const h = (fn) => async (...a) => { tippt({ von: n }); try { await denken(); return fn(...a) } finally { tippt({ von: n, fertig: true }) } }
    return { ...g, abend: h(g.abend), nacht: g.nacht, diskussion: h(g.diskussion), abstimmung: h(g.abstimmung) }
  }

  function partie({ name, zuschauen } = {}) {
    const spieler = zuschauen ? null : pruefeName(name)
    const namen = [...KI_FIGUREN, zuschauen ? ZUSCHAUER_ERSATZ : spieler]
    if (new Set(namen.map((n) => n.toLowerCase())).size !== namen.length) throw new Error('Der Name ist schon vergeben')
    const sw = startwert ?? Date.now()
    const z = zufall(sw)
    const p = P.neuePartie(namen, z, { spieler })
    const figuren = Object.fromEntries(namen.map((n) => [n, n === spieler ? SPIELER_AUSSEHEN : AUSSEHEN[n]]))
    const sp = { p, spieler, zuschauen: !!zuschauen, mensch: null, figuren, beendet: false, startwert: sw }
    const melde = meldeFuer(sp)
    const mitPetze = !!P.petze(p)
    const gehirne = {}
    for (const n of namen) {
      if (n === spieler) { sp.mensch = browserGehirn(n, p.rollen[n], { sende: melde }); gehirne[n] = sp.mensch }
      else gehirne[n] = mitTippen(skriptGehirn(n, p.rollen[n], z, { mitPetze }), n, sp)
    }
    beenden()                       // alte Partie stoppt
    spiel = sp
    const beobachter = (e) => { if (sp.beendet) return; if (sichtbar(sp, e)) sende('ereignis', fuerBrowser(e)); sende('status', status()) }
    // Erst im naechsten Takt los, damit der Browser vorher aufraeumen und zuhoeren kann
    sp.lauf = schlafe(0)
      .then(() => spieleBisZumEnde(p, gehirne, { zufall: z, beobachter, abbruch: () => sp.beendet, pause: () => (pause > 0 ? schlafe(pause) : Promise.resolve()) }))
      .then(() => { if (!sp.beendet) sende('status', status()) })
      .catch(() => {
        if (sp.beendet) return
        if (p.phase !== 'ende') { p.phase = 'ende'; p.sieger = p.sieger || null }
        sende('status', status())
      })
    return status()
  }

  function beenden() {
    if (!spiel) return
    spiel.beendet = true
    if (spiel.p.phase !== 'ende') spiel.mensch?.abbrechen()
  }

  return {
    // Ereignisse wie beim Server-Stream: status, ereignis, tippt, warte
    an(art, fn) { if (!hoerer.has(art)) hoerer.set(art, new Set()); hoerer.get(art).add(fn); return () => hoerer.get(art).delete(fn) },
    partie,
    aktion(a) { const fehler = spiel?.mensch ? spiel.mensch.aktion(a ?? {}) : 'Keine laufende Partie'; return { ok: !fehler, fehler } },
    status,
    beenden,
    lauf: () => spiel?.lauf ?? Promise.resolve(),
    partieObjekt: () => spiel?.p ?? null,
    // Wie GET /protokoll im Server: erst nach dem Ende, sonst null
    protokoll: () => (spiel && spiel.p.phase === 'ende' ? protokollText(spiel.p, { startwert: spiel.startwert }) : null),
  }
}

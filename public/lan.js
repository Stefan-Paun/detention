// LAN-Modus im Browser: Beitritt mit Code, Lobby, Token auf dem Geraet, und die Gastgeber-Box am Rechner.
// Der Server (server.mjs, Routen unter /lan) prueft jede Aktion gegen das Token; hier ist nur Oberflaeche.
// Namen anderer Spieler kommen immer per textContent ins DOM. Keine node:-Importe (tools/seite.mjs).

const SCHLUESSEL = 'nachsitzen.lan.token'
const $ = (id) => document.getElementById(id)

export const lanToken = {
  lies() { try { return localStorage.getItem(SCHLUESSEL) || '' } catch { return '' } },
  setze(t) { try { localStorage.setItem(SCHLUESSEL, t) } catch {} },
  weg() { try { localStorage.removeItem(SCHLUESSEL) } catch {} },
}

// fetch mit Token (Kopfzeile, nie in der URL ausser bei EventSource)
export async function lanAnfrage(pfad, body) {
  const kopf = { 'x-nachsitzen-token': lanToken.lies() }
  if (body !== undefined) kopf['content-type'] = 'application/json'
  const r = await fetch(pfad, { method: body === undefined ? 'GET' : 'POST', headers: kopf, body: body === undefined ? undefined : JSON.stringify(body) })
  let d = null
  try { d = await r.json() } catch {}
  return { status: r.status, ok: r.ok && d?.ok !== false, daten: d, fehler: d?.fehler || (r.ok ? '' : `Fehler ${r.status}`) }
}
export const ereignisUrl = () => `/lan/ereignisse?token=${encodeURIComponent(lanToken.lies())}`

function zeile(ul, name, rechts, knopf = null) {
  const li = document.createElement('li')
  const n = document.createElement('span'); n.className = 'n'; n.textContent = name; li.appendChild(n)
  const b = document.createElement('span'); b.className = `b${rechts.ja ? ' ja' : ''}`; b.textContent = rechts.text; li.appendChild(b)
  if (knopf) li.appendChild(knopf)
  ul.appendChild(li)
}
function kleinerKnopf(text, tu) { const b = document.createElement('button'); b.type = 'button'; b.className = 'knopf leise'; b.textContent = text; b.onclick = tu; return b }

// --- Gast (und Gastgeber mit eigenem Platz): /?lan=1 -----------------------------------
// verbinde(): EventSource oeffnen; zurSpielansicht(): Raum zeigen
export function lanGast({ verbinde, zurSpielansicht }) {
  let bereit = false
  // Am Rechner selbst (localhost) braucht es keinen Code
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) $('lancodefeld').hidden = true

  function zeigeBeitritt(fehler = '') {
    $('lan').hidden = false; $('lanbeitritt').hidden = false; $('lanlobby').hidden = true
    $('lanfehler').textContent = fehler
  }
  function zeigeLobby(d) {
    if (!d) return
    $('lanich').textContent = d.ich || ''
    const ul = $('lanplaetze'); ul.innerHTML = ''
    for (const p of d.plaetze) zeile(ul, p.name === d.ich ? `${p.name} (du)` : p.name, { text: p.bereit ? 'bereit' : 'wartet', ja: p.bereit })
    for (let i = d.plaetze.length; i < d.max; i++) zeile(ul, '–', { text: 'frei' })
    bereit = !!d.plaetze.find((p) => p.name === d.ich)?.bereit
    $('lanbereit').textContent = bereit ? 'Doch nicht bereit' : 'Ich bin bereit'
    $('lanbereit').setAttribute('aria-pressed', String(bereit))
    $('lanbereit').hidden = !d.offen
    $('lanzumspiel').hidden = !d.laeuft
  }

  $('lanbeitritt').onsubmit = async (ev) => {
    ev.preventDefault()
    const name = $('lanname').value.trim()
    if (!name) { $('lanname').focus(); return }
    const r = await lanAnfrage('/lan/beitreten', { code: $('lancodeein').value, name })
    if (!r.ok) { $('lanfehler').textContent = r.fehler; return }
    lanToken.setze(r.daten.token)
    $('lanfehler').textContent = ''
    $('lanbeitritt').hidden = true; $('lanlobby').hidden = false
    verbinde()
  }
  $('lanbereit').onclick = async () => {
    const r = await lanAnfrage('/lan/bereit', { bereit: !bereit })
    $('lanfehler').textContent = r.ok ? '' : r.fehler
  }
  $('lanzumspiel').onclick = () => zurSpielansicht()

  return {
    // Beim Laden: Token noch gueltig? Dann direkt in Lobby oder Partie
    async start() {
      $('start').hidden = true
      if (!lanToken.lies()) { zeigeBeitritt(); return }
      const r = await lanAnfrage('/lan/lobby')
      if (r.status !== 200) { lanToken.weg(); zeigeBeitritt(r.status === 403 ? '' : r.fehler); return }
      $('lan').hidden = false; $('lanbeitritt').hidden = true; $('lanlobby').hidden = false
      zeigeLobby(r.daten)
      verbinde()
    },
    lobby: zeigeLobby,
    // Platz an die KI gegeben oder aus der Lobby genommen: Token weg, neu beitreten
    weg(text) { lanToken.weg(); $('raum').hidden = true; $('eingabe').hidden = true; zeigeBeitritt(text) },
    zurLobby() { $('raum').hidden = true; $('eingabe').hidden = true; $('lan').hidden = false; $('lanlobby').hidden = false; $('lanbeitritt').hidden = true },
  }
}

// --- Gastgeber am Rechner (localhost): Code, Adresse, Plaetze, Start, Uebergabe -----------
export async function lanGastgeber() {
  let r
  try { r = await fetch('/lan/lobby') } catch { return null }
  if (r.status !== 200) return null   // ohne --lan: nichts anzeigen
  const post = async (pfad, body) => {
    const a = await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    let d = null; try { d = await a.json() } catch {}
    return d ?? { ok: false, fehler: `Fehler ${a.status}` }
  }
  function zeige(d) {
    if (!d?.gastgeber) return
    $('lanbox').hidden = false
    $('lancode').textContent = d.offen ? d.code : '– läuft –'
    $('lanadresse').textContent = d.adresse || ''
    const ul = $('lanboxplaetze'); ul.innerHTML = ''
    for (const p of d.plaetze) {
      const weg = kleinerKnopf('Platz freigeben', async () => { const e = await post('/lan/uebergeben', { name: p.name }); $('lanboxfehler').textContent = e.ok ? '' : e.fehler })
      zeile(ul, p.name, { text: p.bereit ? 'bereit' : 'wartet', ja: p.bereit }, d.offen ? weg : null)
    }
    if (!d.plaetze.length) zeile(ul, 'Noch niemand da', { text: '' })
    $('lanstart').disabled = !d.offen || !d.plaetze.length || d.plaetze.some((p) => !p.bereit)
    // Waehrend der Partie: Leiste oben, um einen Platz an die KI zu geben
    const leiste = $('lanleiste'); leiste.innerHTML = ''
    leiste.hidden = !d.laeuft || !d.menschen?.length
    for (const n of d.menschen ?? []) {
      const b = kleinerKnopf(`${n} → KI`, async () => {
        if (!confirm(`${n}s Platz an die KI geben? ${n} kann danach nicht mehr eingreifen.`)) return
        const e = await post('/lan/uebergeben', { name: n })
        if (!e.ok) alert(e.fehler)
      })
      b.title = `${n}s Platz spielt ab jetzt eine KI-Figur`
      leiste.appendChild(b)
    }
  }
  $('lanstart').onclick = async () => {
    const e = await post('/lan/start', {})
    $('lanboxfehler').textContent = e.ok ? '' : e.fehler
    if (e.ok) location.reload()   // die Seite zeigt dann die laufende Partie (nur Oeffentliches)
  }
  zeige(await r.json())
  // Ohne laufende Partie gibt es am Rechner keinen Stream: die Lobby alle 2 s neu holen, solange der Start sichtbar ist
  setInterval(async () => {
    if ($('start').hidden || document.hidden) return
    try { const n = await fetch('/lan/lobby'); if (n.ok) zeige(await n.json()) } catch {}
  }, 2000)
  return { zeige }
}

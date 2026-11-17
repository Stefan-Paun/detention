// Baut die statische Seite fuer GitHub Pages (Browser-Demo ohne Server und Schluessel):
//   node tools/seite.mjs [_site]
// public/* kommt nach oben, dazu genau die Dateien aus spiel/, die der Browser importiert
// (Huelle aller Importe ab public/*.js). Importe '../spiel/x.mjs' werden zu './spiel/x.mjs'.
// Alles Ausgelieferte darf kein node: importieren; sonst bricht der Bau ab.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OEFFENTLICH = path.join(WURZEL, 'public')
const IMPORT = /(?:^|[;\s])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[;\s])import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

// Alle Import-Ziele einer Datei (nur statische Strings)
export function importeVon(text) {
  const ohneKommentare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
  return [...ohneKommentare.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3])
}

// Repo-relative Pfade aller Dateien ausserhalb von public/, die der Browser laedt (z. B. spiel/zufall.mjs)
export function browserModule() {
  const offen = fs.readdirSync(OEFFENTLICH).filter((f) => f.endsWith('.js')).map((f) => path.join(OEFFENTLICH, f))
  const gesehen = new Set(offen)
  const draussen = new Set()
  while (offen.length) {
    const datei = offen.pop()
    for (const ziel of importeVon(fs.readFileSync(datei, 'utf8'))) {
      if (!ziel.startsWith('.')) throw new Error(`${path.relative(WURZEL, datei)} importiert „${ziel}“ – im Browser gehen nur relative Importe`)
      const voll = path.resolve(path.dirname(datei), ziel)
      const rel = path.relative(WURZEL, voll)
      if (rel.startsWith('..') || !fs.existsSync(voll)) throw new Error(`${path.relative(WURZEL, datei)}: Import „${ziel}“ fehlt`)
      if (!voll.startsWith(OEFFENTLICH + path.sep)) {
        if (!rel.startsWith('spiel' + path.sep)) throw new Error(`${path.relative(WURZEL, datei)}: „${ziel}“ liegt weder in public/ noch in spiel/`)
        draussen.add(rel.split(path.sep).join('/'))
      }
      if (!gesehen.has(voll)) { gesehen.add(voll); offen.push(voll) }
    }
  }
  return [...draussen].sort()
}

// Pfad '../spiel/' -> './spiel/' fuer Dateien, die nach oben wandern
const umschreiben = (text) => text.replace(/(['"])\.\.\/spiel\//g, '$1./spiel/')

export function baueSeite(ziel) {
  const module = browserModule()
  fs.rmSync(ziel, { recursive: true, force: true })
  fs.mkdirSync(path.join(ziel, 'spiel'), { recursive: true })
  const geschrieben = []
  for (const f of fs.readdirSync(OEFFENTLICH)) {
    const quelle = path.join(OEFFENTLICH, f)
    if (fs.statSync(quelle).isDirectory()) continue
    const inhalt = f.endsWith('.js') ? umschreiben(fs.readFileSync(quelle, 'utf8')) : fs.readFileSync(quelle)
    fs.writeFileSync(path.join(ziel, f), inhalt); geschrieben.push(f)
  }
  for (const m of module) { fs.copyFileSync(path.join(WURZEL, m), path.join(ziel, m)); geschrieben.push(m) }
  // Sicherung: nichts Ausgeliefertes darf node: importieren
  for (const f of geschrieben.filter((f) => /\.m?js$/.test(f))) {
    const text = fs.readFileSync(path.join(ziel, f), 'utf8')
    const node = importeVon(text).filter((i) => i.startsWith('node:'))
    if (node.length || /['"]node:/.test(text)) throw new Error(`${f} importiert node: (${node.join(', ') || 'node:…'}) – das geht im Browser nicht`)
  }
  fs.writeFileSync(path.join(ziel, '.nojekyll'), '')
  return geschrieben.sort()
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const ziel = path.resolve(process.argv[2] || '_site')
  const dateien = baueSeite(ziel)
  console.log(`Seite gebaut: ${dateien.length} Dateien in ${path.relative(process.cwd(), ziel) || '.'}`)
}

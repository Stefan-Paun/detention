// Speicher fuer die Partien-Statistik: eine JSON-Zeile pro beendeter Partie in partien.jsonl im
// Datenordner (neben kosten.json und hefte/). Datei 0600, Ordner 0700 wie bei den Heften.
// Was in einer Zeile steht, legt ./statistik.mjs fest (nur Figurennamen, keine Heftinhalte).

import fs from 'node:fs'
import path from 'node:path'
import { standardOrdner } from './ordner.mjs'

export const PARTIEN_DATEI = 'partien.jsonl'

export function partienSpeicher({ ordner = standardOrdner() } = {}) {
  const datei = path.join(ordner, PARTIEN_DATEI)
  return {
    datei,
    anhaengen(zeile) {
      if (!zeile) return false
      fs.mkdirSync(ordner, { recursive: true, mode: 0o700 })
      fs.appendFileSync(datei, `${JSON.stringify(zeile)}\n`, { mode: 0o600 })
      try { fs.chmodSync(datei, 0o600) } catch {}   // aeltere Datei mit anderen Rechten nachziehen
      return true
    },
    // Alle lesbaren Zeilen, aelteste zuerst; kaputte Zeilen (von Hand bearbeitet) werden uebersprungen.
    lesen() {
      let text
      try { text = fs.readFileSync(datei, 'utf8') } catch { return [] }
      const zeilen = []
      for (const t of text.split('\n')) {
        if (!t.trim()) continue
        try { zeilen.push(JSON.parse(t)) } catch {}
      }
      return zeilen
    },
  }
}

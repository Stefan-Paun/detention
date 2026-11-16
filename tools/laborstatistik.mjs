// Statistik fuer das Balance-Labor: reine Funktionen, kein Zufall, kein Netz.
// Quoten bekommen ein Wilson-Intervall (95 %); zwei Varianten gelten nur dann als verschieden,
// wenn sich ihre Intervalle nicht ueberlappen. Das ist absichtlich vorsichtig: lieber "nicht belegt"
// als ein Unterschied, den die Daten nicht tragen.

export const Z95 = 1.959963984540054   // 97,5-%-Quantil der Normalverteilung

// Wilson-Intervall fuer `treffer` aus `n` Versuchen. Ohne Versuche ist alles moeglich: [0, 1].
export function wilson(treffer, n, z = Z95) {
  if (!Number.isInteger(treffer) || !Number.isInteger(n) || n < 0 || treffer < 0 || treffer > n) throw new Error(`Ungültige Zählung: ${treffer} von ${n}`)
  if (n === 0) return { treffer, n, quote: null, unten: 0, oben: 1 }
  const p = treffer / n, z2 = z * z
  const nenner = 1 + z2 / n
  const mitte = (p + z2 / (2 * n)) / nenner
  const halb = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / nenner
  // An den Raendern exakt 0 bzw. 1 (sonst bleibt Rundungsrauschen wie 1e-17 stehen)
  return { treffer, n, quote: p, unten: treffer === 0 ? 0 : Math.max(0, mitte - halb), oben: treffer === n ? 1 : Math.min(1, mitte + halb) }
}

// Vergleich zweier Quoten (Ergebnisse von `wilson`). `belegt` nur, wenn die Intervalle getrennt sind.
// richtung: 'hoeher' | 'niedriger' (b gegen a) oder null, wenn nichts belegt ist.
export function vergleiche(a, b) {
  if (a.quote == null || b.quote == null) return { differenz: null, ueberlappen: true, belegt: false, richtung: null }
  const ueberlappen = a.unten <= b.oben && b.unten <= a.oben
  return { differenz: b.quote - a.quote, ueberlappen, belegt: !ueberlappen, richtung: ueberlappen ? null : (b.quote > a.quote ? 'hoeher' : 'niedriger') }
}

// Ein Satz zum Vergleich, der nichts behauptet, was die Daten nicht tragen.
export function urteil(v, was = 'Quote') {
  if (v.differenz == null) return 'keine Daten'
  const punkte = `${v.differenz >= 0 ? '+' : '−'}${Math.abs(100 * v.differenz).toFixed(1).replace('.', ',')} Punkte`
  if (!v.belegt) return `${punkte}, nicht belegt (Intervalle überlappen)`
  return `${punkte}, ${was} ${v.richtung === 'hoeher' ? 'höher' : 'niedriger'} (Intervalle getrennt)`
}

// Zahlen fuer Menschen: deutsches Komma, feste Stellen.
export function prozent(x, stellen = 1) { return x == null ? '–' : `${(100 * x).toFixed(stellen).replace('.', ',')} %` }
export function zahl(x, stellen = 2) { return x == null ? '–' : x.toFixed(stellen).replace('.', ',') }
export function spanne(w) { return w.quote == null ? '–' : `${prozent(w.quote)} [${(100 * w.unten).toFixed(1).replace('.', ',')}–${(100 * w.oben).toFixed(1).replace('.', ',')}]` }

// Aussehen der mitgelieferten Figuren fuer die Browser-Demo (public/lokal.js), die figuren/*.json
// nicht lesen kann (kein Server, kein fetch). test/demo.test.mjs prueft, dass es zu figuren/*.json passt.

export const AUSSEHEN = {
  Mira: { haut: '#f1c9a5', haar: '#3b2a1a', frisur: 'zopf', shirt: '#b44a6a' },
  Jonas: { haut: '#e8b58c', haar: '#c98a3a', frisur: 'wuschel', shirt: '#3a8f5c' },
  Lea: { haut: '#f6dcc3', haar: '#1c1c22', frisur: 'lang', shirt: '#4a4e8a' },
  Tarik: { haut: '#c98b5e', haar: '#161616', frisur: 'kurz', shirt: '#c7772c' },
  Nora: { haut: '#efc6a8', haar: '#7a3b1e', frisur: 'bob', shirt: '#2f7f8f' },
  Sam: { haut: '#e9c2a0', haar: '#5a3a22', frisur: 'kurz', shirt: '#6b6b6b' },
  Ben: { haut: '#d9a97e', haar: '#2e2622', frisur: 'kurz', shirt: '#3b3b52' },
}

// Der Mensch (wie im Server)
export const SPIELER_AUSSEHEN = { haut: '#f1cfb0', haar: '#2b2118', frisur: 'wuschel', shirt: '#bd93f9' }

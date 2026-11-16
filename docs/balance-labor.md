# Balance-Labor: was die aktuellen Regeln aushalten

Gemessen mit `node tools/labor.mjs` (Standard: 2000 Skript-Partien je Variante, Startwerte 1–2000) und zur Kontrolle ein zweites Mal mit `--startwert 2001`. Angegeben ist die **Siegquote des Schattens** mit Wilson-Intervall (95 %). Ein Unterschied zur Basis gilt nur als belegt, wenn sich die Intervalle nicht überlappen.

| Variante | Startwerte 1–2000 | gegen Standard | Startwerte 2001–4000 |
|---|---|---|---|
| Standard (7 Figuren) | 44,1 % [41,9–46,3] | Basis | 45,3 % [43,1–47,5] |
| Gleichstand: Stichwahl | 44,3 % [42,1–46,5] | nicht belegt | 45,6 % [43,5–47,8] |
| Gleichstand: Los | 44,6 % [42,4–46,8] | nicht belegt | 46,3 % [44,1–48,4] |
| Eine Sprechrunde | 43,0 % [40,8–45,2] | nicht belegt | 45,1 % [42,9–47,3] |
| Drei Sprechrunden | 45,8 % [43,6–47,9] | nicht belegt | 46,0 % [43,8–48,1] |
| Ohne Petze | 51,9 % [49,8–54,1] | **höher** | 51,1 % [48,9–53,3] |
| Petze jede Nacht | 39,4 % [37,2–41,5] | niedriger (nur in diesem Lauf) | 42,1 % [40,0–44,3] |
| Ohne Untersuchungen | 44,6 % [42,5–46,8] | nicht belegt | 45,8 % [43,6–47,9] |
| Ohne Tagesereignisse | 45,6 % [43,4–47,8] | nicht belegt | 44,0 % [41,8–46,2] |
| Schluss nach Nacht 2 | 46,9 % [44,8–49,1] | nicht belegt | 48,3 % [46,1–50,5] |
| 6 Figuren | 41,1 % [39,0–43,3] | nicht belegt | 41,4 % [39,3–43,6] |
| 8 Figuren | 31,8 % [29,7–33,8] | **niedriger** | 30,6 % [28,6–32,7] |
| Schatten-Strategien gemischt | 45,1 % [42,9–47,3] | nicht belegt | 45,7 % [43,5–47,9] |

## Befund

- **Der Standard liegt im Ziel.** 44,1 % und 45,3 % Schattenquote bei 7 Figuren, beide Intervalle ganz im Zielbereich 40–60 % aus `docs/balance-petze.md`. Die Partien dauern im Schnitt 2,2 Nächte, nie länger als 4.
- **Die Petze ist die einzige Regel, die das Gleichgewicht sicher trägt.** Ohne sie steigt die Schattenquote in beiden Läufen um 6 bis 8 Punkte (Intervalle getrennt). Das bestätigt die Messung in `docs/balance-petze.md`.
- **„Petze jede Nacht“ ist nicht sicher schlechter für den Schatten.** Im ersten Lauf sind die Intervalle getrennt (−4,7 Punkte), im zweiten überlappen sie (−3,2 Punkte). Die Richtung stimmt beide Male, die Größe ist mit 2000 Partien nicht fest. Wer das genau wissen will: `--partien 10000`.
- **8 Figuren kippen zugunsten der Schüler** (rund 31 %, in beiden Läufen belegt, unter dem Zielbereich). Das ist die bekannte Grundmechanik, keine neue Erkenntnis, aber jetzt mit Intervall.
- **Gleichstand, Sprechrunden, Untersuchungen, Tagesereignisse: kein belegter Einfluss auf die Siegquote.** Stichwahl und Los verschieben die Quote um weniger als einen Punkt. Ein Grund: Bei Skript-Gehirnen endet nur etwa jede 26. Abstimmung ohne Keller (3,8 %), es gibt also wenig zu entscheiden; in 2000 Partien kam es zu 134 Stichwahlen. Diese Regeln sind damit eine Frage des Spielgefühls, nicht der Balance. Mit Claude-Figuren kann das anders sein (siehe unten).
- **„Schluss nach Nacht 2“** verkürzt die Partie von 2,2 auf 1,7 Nächte; fast jede zweite Partie (939 von 2000) endet dann durch den Schluss statt durch Einsperren oder Übrigbleiben. Die Schattenquote steigt um etwa 3 Punkte, belegt ist das nicht.
- **Schlüsselträger:** In 38,5 % der Partien prüft er irgendwann den Schatten; danach gewinnen die Schüler in 62,3 % dieser Partien (gegen 55,9 % insgesamt). Eine „Rettung“ gibt es in Nachsitzen nicht (der Schlüsselträger prüft, er schützt nicht); diese Kennzahl ersetzt sie.
- **Schatten fliegt in Nacht 1:** 29,3 % im Standard. Bei 7 Figuren wäre reines Raten 1/6 ≈ 16,7 % pro Abstimmung mit Ergebnis; Schlüsselträger und Petze heben das deutlich.
- **Skript-Strategien des Schattens:** Im ersten Lauf sah „lauteste holen“ (50,2 %) klar besser aus als „leiseste holen“ (40,2 %), Intervalle getrennt. Im zweiten Lauf liegen alle drei bei 45–47 %. Das ist ein Lehrstück für Zufallstreffer bei vielen Vergleichen mit je nur 667 Partien: **kein belegter Unterschied**.

## Empfehlung

Die Standardregeln bleiben, wie sie sind. Aus den Daten folgt keine Änderung: Keine der getesteten Varianten bringt die Quote bei 7 Figuren näher an 50 %, ohne etwas anderes zu verschieben. Wer 8 Figuren spielen will, sollte dort die Basis nachjustieren (zum Beispiel mit einer eigenen Variantendatei `{"figuren": 8, "regeln": {"petze": false}}` anfangen und messen).

## Was die Zahlen nicht sagen

- Gespielt haben Skript-Gehirne mit festen Strategien. Sie werten die Spurentafel nicht aus und reden in Floskeln; Regeln, die mehr Gespräch oder mehr Beweise bringen (Sprechrunden, Untersuchungen), können sie deshalb kaum nutzen. Dass diese Regeln hier „nichts ändern“, heißt nur: nichts für Skripte.
- Alle Varianten nutzen dieselben Startwerte. Das macht die Läufe vergleichbar, der Vergleich über getrennte Intervalle behandelt sie trotzdem wie unabhängige Stichproben und ist damit eher zu vorsichtig als zu mutig.
- Bei zwölf Vergleichen gegen die Basis ist ein einzelner Zufallstreffer möglich. Was zählt, ist, was sich mit einem zweiten Startwert wiederholt.

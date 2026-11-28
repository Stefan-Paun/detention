# Nachsitzen

Nachts in der Schule eingesperrt, mit sechs KI-Figuren. Eine davon ist der Schatten.

![Eine Partie Nachsitzen: das Pixel-Klassenzimmer, darunter der Chat der Figuren, rechts die Spurentafel](docs/img/demo.gif)

Ein Spiel im Stil von Werwolf, nur dass die Mitspieler Claude-Figuren sind: Jede hat ihren eigenen Charakter, sieht nachts nur, was in ihrer Nähe passiert, lügt über ihren Platz, wenn es ihr nützt, und schreibt nach der Partie in ihr **Heft**, wem sie traut. Beim nächsten Spiel liest sie es wieder. Du bist eine der sieben Figuren. Vielleicht der Schatten.

*English in one paragraph: a social-deduction game (think Werewolf) where the other six players are Claude characters with separate hidden knowledge, real night-time evidence (ink trails, chalk dust, witnesses), and a notebook that carries grudges and trust across games. German only for now. You run it locally with your own Anthropic API key; a game costs a few cents.*

## Ausprobieren ohne Schlüssel: die Browser-Demo

**[stefanpaun.page/detention](https://stefanpaun.page/detention/)** spielt eine Partie direkt im Browser, ohne Server, ohne Anmeldung, ohne Schlüssel und ohne Kosten. Ehrlich gesagt: Dort spielen **Skript-Figuren**, keine KI. Sie folgen festen Regeln: Sie nennen ihren Platz, geben weiter, was sie nachts gesehen haben, halten Behauptungen gegen Beobachtungen („Mira, du sagst Fenster, aber du warst bei den Pulten“), und der Schatten lügt. Regeln, Spuren, Spurentafel und Pixel-Klassenzimmer sind dieselben wie im echten Spiel. Die Demo schickt nichts weg; gespeichert werden nur deine Einstellungen (Ton, Schrecken, Dämmerung) im Browser.

Lokal geht dieselbe Demo mit `npm start` und `http://localhost:4800/?demo=1`. Über LAN-IP oder Tailscale erzwingt `?demo=0` den echten Server.

*Browser demo: play in the browser against scripted characters (not AI), no server, no key, nothing sent anywhere.*

## Spielen mit deiner eigenen KI

Nachsitzen läuft nur auf deinem Rechner. Die Figuren denken mit Claude; dafür brauchst du einen **eigenen API-Schlüssel von Anthropic**. Es gibt keinen Server von mir, keine Anmeldung, nichts wird irgendwohin geschickt außer an die Claude-API.

**1. Voraussetzungen**

- [Node.js](https://nodejs.org) 20 oder neuer (`node --version`)
- einen Anthropic-API-Schlüssel: Konto auf [console.anthropic.com](https://console.anthropic.com) anlegen, ein paar Dollar Guthaben laden, unter *API Keys* einen Schlüssel erzeugen. Er beginnt mit `sk-ant-`.

**2. Holen**

```
git clone https://github.com/Stefan-Paun/nachsitzen.git
cd nachsitzen
```

Es gibt nichts zu installieren: keine Abhängigkeiten, kein Build.

**3. Schlüssel verbinden** (eine der beiden Möglichkeiten)

| Wo | So |
|---|---|
| Umgebungsvariable (Mac, Linux, Windows) | `export ANTHROPIC_API_KEY=sk-ant-…` vor dem Start (Windows PowerShell: `$env:ANTHROPIC_API_KEY="sk-ant-…"`) |
| macOS-Schlüsselbund (bleibt dauerhaft, landet nie in einer Datei) | `security add-generic-password -a "$USER" -s anthropic-api-key -w` und den Schlüssel eintippen |

Der Schlüssel wird nur vom lokalen Server gelesen und nie an den Browser geschickt. Er gehört nicht ins Repo und in keine Datei im Projekt.

**4. Starten**

```
npm start
```

Dann [http://localhost:4800](http://localhost:4800) öffnen, Namen eintippen, **Mitspielen**. Mit **Nur zuschauen** spielen sieben Figuren ohne dich. Beim Zuschauen stellst du oben das Tempo ein (**Langsam**, **Normal**, **Schnell**) und hältst mit **Pause** an; solange Pause ist, startet keine Figur einen neuen (kostenpflichtigen) Zug. Ohne Browser: `POST /aktion` mit `{"art":"tempo","wert":"schnell"}` oder `{"art":"pause","wert":true}`. Beenden mit `Strg+C`.

**Ohne Schlüssel ausprobieren:** `npm start -- --skript` startet dieselbe Oberfläche mit einfachen Skript-Figuren. Die reden Unsinn, aber du siehst das Spiel, kostenlos.

**5. Was es kostet**

Die Figuren laufen auf Claude Haiku 5.5. Eine Partie braucht 40 bis 80 Aufrufe und kostet **etwa 2 bis 4 Cent**. Eingebaut ist ein **Tagesdeckel von 0,50 $**: Ist er erreicht, verstummen die Figuren bis zum nächsten Tag, und der Browser sagt dir das. Den Deckel setzt du per Umgebungsvariable, z. B. `NACHSITZEN_DECKEL=1.00 npm start` (Dollar, Zahl > 0; sonst gilt der Standard und es gibt eine Warnung), das Modell änderst du in `spiel/claude.mjs` (`MODELL`). Verbrauch nachsehen: `npm run kosten` (Tabelle der letzten 14 Tage; die Zahlen liegen in `kosten.json` im Datenordner: `~/.local/share/nachsitzen`, unter Windows `%LOCALAPPDATA%\nachsitzen`).

**Wenn etwas nicht geht**

| Meldung | Ursache |
|---|---|
| `Kein API-Schluessel` | Umgebungsvariable nicht gesetzt oder kein Schlüsselbund-Eintrag `anthropic-api-key` |
| `API 401` | Schlüssel falsch oder widerrufen |
| `API 400` mit `credit balance` | kein Guthaben im Anthropic-Konto |
| Figuren schweigen, Rückfall-Meldungen im Terminal | Tagesdeckel erreicht oder Netz weg; `npm start` zeigt es |
| Port belegt | `NACHSITZEN_PORT=4801 npm start` |

Nach jeder Partie, in der du mitspielst, zeigt die Karte **So lief es** unter der Wahrheit, wer wann fiel, ob du gewonnen hast und wer am öftesten gegen dich gestimmt hat, dazu eine Zeile über alle Partien („Partie 7: 3 Siege als Schüler, 1 als Schatten“). Dafür kommt eine Zeile in `partien.jsonl` im Datenordner (nur Rolle, Sieger, Nächte und Figurennamen; nicht dein Name, nichts aus den Heften; Zuschauer-Partien zählen nicht). `npm run statistik` druckt die Tabelle.

Mitspielen geht auch ohne Browser: `node tools/zug.mjs 4800 --neu DeinName`, dann `node tools/zug.mjs 4800` und die Befehle, die es vorschlägt; `--tafel` zeigt die Spurentafel als Text. `npm run spiele` spielt ganz im Terminal und blendet die Tafel vor jedem Gespräch ein.

## Was passiert

| Phase | |
|---|---|
| Abend | Sieben sitzen fest: du und sechs Figuren mit eigenem Kopf. Eine ist der Schatten, eine hat den Schlüssel, und eine ist die Petze. |
| Nacht | Jeder stellt sich an einen von vier Plätzen. Der Schatten schleicht zu seinem Opfer. Du bekommst mit, was in deiner Nähe passiert: Schritte, jemand, der sich bewegt, wer neben dir steht. |
| Morgen | Ein Pult ist leer. Die Tintenspur zeigt, von welcher Seite der Schatten kam, Kreidestaub, wo er durchging, manchmal bleibt ein halber Satz des Opfers. Jeder darf einen Platz oder das Klassenbuch untersuchen und sein Ergebnis **vorzeigen**: Vorgezeigt gilt es als bewiesen. |
| Gespräch | Die Figuren vergleichen Behauptungen mit dem, was sie gesehen haben. Wer über seinen Platz lügt, kann auffliegen. Wer angesprochen wird, antwortet als Nächster. |
| Abstimmung | Geheim: Jeder schreibt einen Namen auf einen Zettel, aufgedeckt wird erst am Ende. Wer die meisten Stimmen hat, kommt in den Keller, und die Rolle wird bekannt. |
| Danach | Jede Figur schreibt in ihr Heft, wem sie traut. Beim nächsten Spiel liest sie es wieder. Und das Spiel zeigt die Wahrheit: alle Rollen und wer in welcher Nacht wo stand. |

Jeder Platz hat nachts einen Vorteil: Bei der **Tür** hörst du jeden Schritt im Raum und die Richtung. An der **Tafel** merkst du sicher, wer vorbeihuscht. Bei den **Pulten** siehst du je eine Person links und rechts. Am **Fenster** zeigt das Mondlicht alle, die dort stehen. Untersuchen darf jeder einmal am Tag, höchstens dreimal pro Partie.

**Die Petze** (ab 7 Figuren genau eine) erfährt in Nacht 1, 3, 5 … die Rolle einer Person ihrer Wahl: Schatten, Schlüsselträger, Petze oder Schüler. Niemand sonst sieht, wen sie gewählt hat oder was herauskam; ob sie es weitersagt und ob man ihr glaubt, ist Teil des Spiels (auch der Schatten darf sich als Petze ausgeben). Warum erst ab 7 und nur jede zweite Nacht: [docs/balance-petze.md](docs/balance-petze.md).

Regeln, die man wissen sollte: In der ersten Nacht holt der Schatten nie den menschlichen Spieler. Der Schatten darf einmal pro Partie seine Spur verwischen. Scheidest du aus, schaust du als Geist weiter zu und siehst dann alles, auch die Nacht der anderen. Manchmal passiert etwas: ein Zettel unter der Tür (sagt die Wahrheit), der Hausmeister rüttelt (nur eine Gesprächsrunde), die Glocke läutet (offene Abstimmung).

Begriffe: Die Schule hat sieben **Pulte** (eines je Figur) und vier **Plätze** für die Nacht (Tür, Tafel, Pulte, Fenster). Wer verschwindet, wurde vom Schatten geholt; wer im **Keller** sitzt, wurde eingesperrt.

Regler oben: **Ton** (Wind und Klavier aus WebAudio), **Schrecken** (höchstens einer pro Nacht, nie während du dran bist), **Dämmerung** (alles ruhiger, heller, ohne Bewegung).

## Die Figuren

Mira (Klassensprecherin, will Ordnung), Jonas (Witzbold, lenkt ab), Lea (still, merkt sich Widersprüche), Tarik (impulsiv, loyal), Nora (misstrauisch, rechnet), Sam (neu, glaubt zu schnell) und, wenn du nur zuschaust, Ben (Wiederholer, trocken). Ihre Charaktere stehen in `figuren/*.json`, die Spielregeln für sie in `prompts/`.

### Eigene Figuren

Auf dem Startbild öffnet **Eigene Figuren bauen …** den Editor: Name, Alter, Eigenheiten, Art zu reden, bis zu drei Beispielsätze, ein optionales Geheimnis und das Aussehen. Das Formular prüft beim Tippen (der Server benutzt dasselbe Schema wie beim Speichern), rechts siehst du die Figurenkarte. **Speichern**, **Duplizieren** und **In den Papierkorb** (die Datei wandert in den Unterordner `geloescht`, nichts wird gelöscht). Vor dem Start wählst du die Besetzung: 3 bis 7 KI-Figuren, dazu kommst du (oder Ben beim Zuschauen), also 4 bis 8 im Raum.

- Ablage: `~/.local/share/nachsitzen/figuren/<kennung>.json` (neben den Heften, folgt `XDG_DATA_HOME`). Die Kennung wird aus dem Namen gebildet (nur `a-z`, `0-9`, `-`), nie aus Rohtext. Höchstens 12 eigene Figuren.
- Grenzen (siehe `spiel/figurenschema.mjs`): Name 2 bis 20 Zeichen (Buchstaben, Ziffern, Leerzeichen, `'`, `-`; nicht Mira, Ben, Tür, niemand …), Eigenheiten 20 bis 400, Art zu reden 10 bis 300, Beispielsätze je 5 bis 160, Geheimnis bis 200; keine Steuerzeichen und keine `< > « » { }`.
- Sicherheit: Figurentexte sind Daten. Im Systemprompt stehen sie zwischen `=== FIGURENDATEN … ===`-Markierungen, Steuerzeichen und Markierungen werden zusätzlich entfernt, und die Inhaltsgrenzen aus `prompts/system.md` bleiben unverändert und stehen hinter den Figurendaten. Die Routen `/figuren` prüfen Host und Herkunft (fremde Seiten bekommen 403), nehmen nur `application/json` und höchstens 8 KB. Es gibt kein Teilen oder Hochladen.
- Ohne den Speicher (`erstelleServer` ohne `figuren`) sind Editor und Routen aus; die Oberfläche zeigt dann nur die sechs Standardfiguren.
- Ohne Browser: `curl -X POST -H 'content-type: application/json' -d '{"zuschauen":true,"besetzung":["Mira","Paula","Sam"]}' localhost:4800/partie`.

Die Hefte liegen außerhalb des Repos unter `~/.local/share/nachsitzen/hefte/`. Löschst du sie, fangen die Figuren wieder bei null an.

## Entwickeln

```
npm test                          # Tests ohne Netz: Regeln, Welt, Gehirn mit Fake-API, Server, Simulation, Petze (Sichtbarkeit, Balance), Figuren-Editor
npm run simuliere                 # 100 Partien mit Skript-Gehirnen, Siegquoten
node tools/balance.mjs 2000 1     # Schatten-Siegquote für 4–8 Figuren, mit und ohne Petze
npm run labor                     # Balance-Labor: Regelvarianten in je 2000 Skript-Partien, Tabelle + HTML-Bericht
npm run spiele -- --zuschauen     # eine echte Partie im Terminal (kostet Cent)
npm run statistik                 # Siege nach Rolle, Serien, häufigster Gegner (aus partien.jsonl)
node tools/seite.mjs _site        # statische Browser-Demo bauen (wie der Pages-Workflow)
```

Aufbau: `spiel/partie.mjs` (Regeln; jedes Ereignis weiß, wer es sehen darf), `spiel/regeln.mjs` (die Stellschrauben als ein Objekt, Standard = heutiges Spiel), `spiel/welt.mjs` (die Wahrheit hinter dem Gerede: Plätze, Spuren, Beobachtungen), `spiel/gehirn.mjs` (Claude-Figur mit eigenem Kontext und Werkzeug-Aufrufen), `spiel/hefte.mjs` (Erinnerung), `spiel/figurenschema.mjs` / `spiel/figurenspeicher.mjs` / `spiel/figurentext.mjs` (eigene Figuren: Prüfung, Ablage, Prompt-Bereinigung), `spiel/spurentafel.mjs` (die Spurentafel als Text für Terminal und `zug.mjs --tafel`), `spiel/skriptgehirne.mjs` (Skript-Figuren für Tests, Simulation und Demo), `server.mjs` (lokaler Server, SSE), `public/` (Browser, Pixelszene), `public/lokal.js` (Spielleiter im Browser für die Demo). Was im Browser läuft, darf nichts aus `node:` importieren; `tools/seite.mjs` prüft das beim Bauen. Der Plan mit allen Entscheidungen: [docs/PLAN.md](docs/PLAN.md).

### Balance-Labor

Regeländerungen lassen sich messen, bevor sie ins Spiel kommen. `npm run labor` spielt jede Variante mit Skript-Gehirnen (kein Netz, keine Kosten, ein paar Sekunden) und zeigt Siegquoten, Partielänge, wie oft der Schatten gleich in Nacht 1 fliegt und wie oft der Schlüsselträger ihn findet. Jede Quote hat ein Wilson-Intervall (95 %); ein Unterschied zur ersten Variante gilt nur als belegt, wenn sich die Intervalle nicht überlappen.

```
npm run labor                                             # eingebaute Varianten, Bericht nach ausgabe/labor.html
npm run labor -- --partien 5000 --startwert 2001          # mehr Partien, andere Startwerte
npm run labor -- --varianten meine.json --aus bericht.html
npm run labor -- --kein-html                              # nur die Tabelle im Terminal
```

Eine Variantendatei ist eine Liste; die erste Zeile ist die Basis:

```json
[
  { "name": "Standard" },
  { "name": "Stichwahl, drei Runden", "regeln": { "gleichstand": "stichwahl", "sprechrunden": 3 } },
  { "name": "8 ohne Petze", "figuren": 8, "regeln": { "petze": false }, "schattenStrategie": "zufall" }
]
```

Die Regeln mit ihren Standardwerten stehen in `spiel/regeln.mjs`: `petze`, `petzeAb`, `petzeJede`, `sprechrunden`, `maxUntersuchungen`, `gleichstand` (`niemand`, `stichwahl`, `los`), `schlussNacht`, `tagesereignisse`. Das Spiel selbst läuft immer mit dem Standard; Abweichungen gibt es nur im Labor. Gleicher Startwert ergibt exakt denselben Bericht (er enthält kein Datum). Der Bericht ist eine einzelne HTML-Datei ohne externe Verweise. Was das Labor über die aktuellen Regeln sagt: [docs/balance-labor.md](docs/balance-labor.md).

Harte Grenzen für die Figuren stehen in `prompts/system.md`: Tinte statt Blut, nichts zu Selbstverletzung, nichts Sexuelles, keine echten Personen. Gruselig darf es sein, grausam nicht.

## Lizenz

MIT. Gebaut von Stefan Paun, 17, Wien, mit Claude Code. Feedback gern als Issue.

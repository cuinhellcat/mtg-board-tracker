# Arbeitsauftrag: MTG Board State Tracker – Phase 1 (MVP)

## Projektziel

Baue eine lokale Web-App, die als strukturierter Board-State-Tracker für Magic: The Gathering (Duel Commander, 1v1) dient. Der Nutzer spielt gegen ein LLM und steuert beide Seiten manuell. Das Tool ersetzt die fehleranfällige Freitext-Kommunikation mit dem LLM durch einen sauberen, maschinenlesbaren Boardstate-Export.

**Was dieses Tool NICHT ist:** Kein Regel-Engine, kein automatischer Spielablauf, kein Stack-Management. Der Nutzer ist Judge und Puppenspieler für beide Seiten.

---

## Tech-Stack

- **Backend:** Python (FastAPI), läuft als lokaler Server
- **Frontend:** HTML/CSS/JavaScript (kein Framework-Zwang, aber React wäre ok), läuft im Browser
- **Echtzeit-Sync:** WebSockets zwischen Backend und allen Frontend-Fenster
- **Scryfall API:** Für Kartendaten (kostenlos, muss gecacht werden)

### Zwei-Fenster-Architektur

Die App läuft in **zwei separaten Browser-Fenstern**, gedacht für ein Multi-Monitor-Setup:

**Fenster 1 – Spielfeld (`/board`)** – für einen horizontalen Monitor:
- Nur das Board: Zwei Spielerhälften mit allen Zonen, Karten, Drag-and-Drop
- Maximaler Platz für Karten, kein Chat oder Textfelder hier
- Life Counter und Phase Tracker als kompakte Leiste in der Mitte

**Fenster 2 – Command Center (`/command`)** – für einen vertikalen Monitor:
- Chat-/Gesprächsverlauf mit dem LLM (chronologisch, scrollbar)
- Freitext-Eingabefeld für Nachrichten ans LLM
- Boardstate-Snapshot (live aktualisiert, read-only)
- Action Log (einklappbar)
- Buttons: Export, Copy Boardstate, Undo, Neues Spiel
- Phase Tracker + Life Counter auch hier gespiegelt (damit man nicht rüberschauen muss)

**Start:** Ein Python-Script starten → öffnet automatisch zwei Browser-Fenster/Tabs (`localhost:8000/board` und `localhost:8000/command`). Beide verbinden sich per WebSocket mit dem Backend. Jede Aktion in einem Fenster wird sofort im anderen reflektiert.

---

## Architektur-Grundsätze (WICHTIG)

Diese Prinzipien sind für spätere Erweiterbarkeit entscheidend:

1. **Zentrales State-Modell:** Es gibt EIN `GameState`-Objekt, das die gesamte Wahrheit über das Spiel hält. Die UI rendert davon – sie ist NICHT die Quelle der Wahrheit.

2. **Action-Dispatch-Pattern:** Jede Zustandsänderung (Karte bewegen, tappen, Counter setzen, Life ändern, Phase wechseln) läuft als Action/Event durch eine zentrale Dispatch-Funktion. Niemals direkt im Click-Handler den State manipulieren. Das ermöglicht automatisch:
   - Ein vollständiges Action Log
   - Undo-Funktionalität
   - Spätere Erweiterung durch externe Action-Quellen (Phase 2: LLM schickt Aktionen)

3. **Saubere Trennung:** State-Management, UI-Rendering, Scryfall-Integration und Export-Logik in getrennten Modulen. Kein Spaghetti.

4. **Spieler als Liste:** Die Spieler im GameState werden als Array/Liste modelliert, NICHT als zwei feste Variablen (player1/player2). Für Phase 1 sind es immer genau 2 Einträge, aber die Datenstruktur soll später auf 3-4 Spieler (Multiplayer) erweiterbar sein, ohne die Kernlogik umzubauen.

5. **KEIN Over-Engineering für Phase 2:** Keine abstrakten API-Adapter-Interfaces, keine Plugin-Systeme, keine leeren Stubs. Einfach sauberer, lesbarer, modularer Code.

---

## Modul 1: Scryfall-Integration

### Kartendaten-Cache
- Beim ersten Start: Prüfe ob ein lokaler Cache existiert (JSON-Datei oder SQLite)
- Falls nicht: Lade den Scryfall Bulk Data Export herunter (Oracle Cards, ca. 100MB JSON) und speichere relevante Felder lokal
- Relevante Felder pro Karte: `name`, `oracle_text`, `mana_cost`, `type_line`, `power`, `toughness`, `loyalty`, `colors`, `color_identity`, `cmc`, `image_uris` (alle Größen-URLs speichern)
- Cache-Alter prüfen: Wenn älter als 30 Tage, Hinweis anzeigen dass ein Update verfügbar sein könnte (kein automatisches Update, nur ein Button "Jetzt aktualisieren"). Oracle-Texte ändern sich nur wenige Male pro Jahr bei Set-Releases oder Rules-Updates.

### Kartenbilder-Cache
Scryfall stellt hochauflösende Kartenbilder kostenlos zur Verfügung (672×938px "normal" als JPG). Diese werden lokal gecacht:

- **Beim Decklist-Import:** Alle Bilder der Karten im Deck werden automatisch heruntergeladen und lokal gespeichert (ca. 80-120KB pro Bild, ein 100-Karten-Deck = ca. 10MB)
- **Lazy Loading:** Falls eine Karte noch kein lokales Bild hat, wird es beim ersten Hover on-the-fly von Scryfall geladen und gecacht
- **Optional: "Alle Bilder herunterladen"** – Button in den Einstellungen, der im Hintergrund Bilder für alle ~29.000 unique Karten zieht (ca. 3-4GB, einmaliger Vorgang). Fortschrittsanzeige, unterbrechbar, setzt beim nächsten Mal fort
- **Inkrementelles Update:** Beim Aktualisieren des Kartendaten-Caches werden nur Bilder für neue Karten nachgeladen (Vergleich der Karten-IDs mit dem lokalen Bildverzeichnis)
- **Bild-Host hat kein Rate-Limit** – nur die Scryfall-API selbst ist rate-limited, Bilder können frei geladen werden. Trotzdem: Parallelität auf max. 10 gleichzeitige Downloads begrenzen (fair use)
- Bilder werden nach Karten-ID im Dateisystem abgelegt: `cache/images/{scryfall_id}.jpg`

### Kartensuche
- Fuzzy-Search über Kartennamen im lokalen Cache
- API-Endpoint: `GET /api/cards/search?q=<partial_name>` → Liste von Treffern
- Autocomplete-fähig (Antwortzeit < 100ms)

---

## Modul 2: Decklist-Import

### Format
- Textdatei, eine Karte pro Zeile
- Format: `1 Sol Ring` oder `Sol Ring` (Menge optional, Default 1)
- Zeile mit `COMMANDER:` oder `Commander:` markiert den Commander
- Leerzeilen und Zeilen die mit `//` oder `#` beginnen werden ignoriert
- Alternativ: Sideboard-Sektion nach einer Zeile die nur `Sideboard` enthält (für Duel Commander relevant)

### Ablauf
- Upload einer `.txt` oder `.dec` Datei über die UI
- Jeder Kartenname wird gegen den Scryfall-Cache aufgelöst
- Nicht gefundene Karten: Warnung anzeigen, trotzdem ins Deck aufnehmen (mit manuellem Oracle-Text-Feld)
- Commander → Command Zone, Rest → Library (automatisch gemischt)

### Zwei Decks laden
- Vor Spielbeginn: Deck für jeden Spieler laden (nach Namenseingabe)
- Einfache UI: Zwei Upload-Bereiche, beschriftet mit den gewählten Spielernamen

---

## Modul 3: Board UI

### Layout
- Zwei Spielerhälften, übereinander (LLM-Spieler oben, menschlicher Spieler unten – wie bei Arena/MTGO)
- Spielernamen prominent angezeigt an den jeweiligen Hälften
- Dunkles Farbschema (angenehm für lange Sessions)

### Zonen pro Spieler
Jede Zone ist ein klar abgegrenzter Bereich und ein Drop-Target für Drag-and-Drop:

| Zone | Anzeige | Anmerkungen |
|------|---------|-------------|
| **Command Zone** | Karte(n) voll sichtbar | Commander + Partner falls vorhanden |
| **Battlefield** | Alle Karten sichtbar, tapped/untapped | Größter Bereich |
| **Hand** | Karten sichtbar für den jeweiligen Spieler | LLM-Hand: Kartenrücken oder nur Anzahl? → Beides als Toggle |
| **Graveyard** | Stapel, klickbar zum Aufklappen | Öffentliche Zone |
| **Exile (Standard)** | Stapel, klickbar zum Aufklappen | "Egal-Exil" – Karten die einfach weg sind. Siehe Exile-System unten |
| **Exile (Verknüpft)** | Bei der verknüpften Karte angezeigt | Karten die mit einer bestimmten Karte verbunden sind. Siehe Exile-System unten |
| **Library** | Nur Kartenanzahl sichtbar | Klick → Ziehe oberste Karte in Hand |

### Exile-System (differenziert)

Magic hat regeltechnisch nur eine Exile-Zone, aber für den Boardstate-Export unterscheiden wir:

**Standard-Exil ("Egal-Exil"):**
- Karten die einfach exiliert sind und mit denen niemand mehr interagiert (z.B. durch Swords to Plowshares entfernte Kreaturen)
- In der UI: Normaler Stapel, klickbar zum Aufklappen
- Im Boardstate-Snapshot: Wird **NICHT mitgeschickt** – diese Karten sind für Spielentscheidungen irrelevant und sparen Token

**Verknüpftes Exil:**
- Karten die mit einer bestimmten anderen Karte verknüpft sind
- Zwei typische Fälle:
  1. **"Solange"-Effekte** (z.B. Banishing Light): Karte ist im Exil solange die verknüpfte Karte im Spiel ist. Im Snapshot wird die exilierte Karte direkt bei der verknüpften Karte auf dem Battlefield erwähnt.
  2. **Klau-Effekte** (z.B. Gonti, Canny Acquisitor): Karten werden exiliert und können vom Kontrolleur gespielt werden, egal wo die verknüpfte Karte inzwischen ist. Im Snapshot wird die Info bei der verknüpften Karte erwähnt, egal in welcher Zone sie sich befindet.
- In der UI: Verknüpfte Exile-Karten werden visuell an der "Eltern-Karte" angezeigt (z.B. als kleine Badges oder als aufklappbare Sub-Liste an der Karte)
- Kontextmenü-Aktion: "Ins verknüpfte Exil schicken" → wähle die Karte aus, mit der die Exile-Karte verknüpft werden soll
- Verknüpfung bleibt bestehen, auch wenn die Eltern-Karte die Zone wechselt (z.B. Gonti stirbt → Graveyard, Exile-Karten bleiben mit Gonti verknüpft)

**Aktion zum Umwandeln:** Karten können per Rechtsklick zwischen Standard-Exil und Verknüpftem Exil verschoben werden

### Karten-Darstellung
- **Normal (in Zone):** Kompakte Box/Rechteck mit: Kartenname (fett), Mana Cost (oben rechts, als Text wie `{2}{U}{B}`), Type Line (klein, darunter)
- **Hover:** Großes Kartenbild (aus dem lokalen Bilder-Cache, 672×938px) als Popup/Overlay. Falls Bild noch nicht gecacht: Oracle-Text als Fallback anzeigen, Bild im Hintergrund laden. Zusätzlich unter dem Bild: aktuelle Counters und andere Statusinfos anzeigen, falls vorhanden.
- **Tapped:** Box um 90° gedreht (CSS transform)
- **Während Drag:** Kompakter "Knödel" – nur Name in kleiner Box oder farbiger Punkt nach Kartenfarbe (W=weiß, U=blau, B=schwarz/dunkelgrau, R=rot, G=grün, Mehrfarbig=gold, Farblos=grau)

### Interaktionen
- **Drag-and-Drop:** Karten zwischen beliebigen Zonen verschieben
- **Klick:** Tappen/Untappen (Toggle)
- **Rechtsklick-Kontextmenü:**
  - +1/+1 Counter hinzufügen/entfernen
  - Beliebigen Counter-Typ hinzufügen (z.B. Loyalty, Charge, etc.)
  - Token erstellen (Name + P/T eingeben, wird als Karte ohne Oracle-Text erstellt)
  - Karte klonen (für Copy-Effekte)
  - Zur Hand nehmen / Auf Library legen (oben/unten) / Ins Exile / In den Graveyard
  - Löschen (für Tokens die das Spiel verlassen)
- **Library-Interaktionen:**
  - Klick: Oberste Karte ziehen (→ Hand)
  - Kontextmenü: Mischen, "Scry X" (zeige die obersten X Karten, ordne sie per Drag-and-Drop)
  - Karte suchen (öffnet Suchfeld, gefundene Karte kann in Hand/Battlefield genommen werden, danach mischen)

### Life Counter
- Pro Spieler: Großer Zahlenwert, +/- Buttons
- Startlife: 20 (Duel Commander)
- Commander Damage Tracking: Separater kleiner Zähler pro gegnerischem Commander

### Phase Tracker
- Leiste oben oder in der Mitte: `Untap → Upkeep → Draw → Main 1 → Combat (Begin → Attackers → Blockers → Damage → End) → Main 2 → End → Cleanup`
- Aktuelle Phase hervorgehoben
- Klick auf nächste Phase zum Weiterschalten
- Anzeige wessen Turn es ist
- **Kein Erzwingen** – der Nutzer kann jederzeit zu jeder Phase springen

---

## Modul 4: Action Log

### Vollständiges Log (Schicht 1)
- Chronologisch, jede einzelne Aktion wird aufgezeichnet
- Format-Beispiele (hier mit Beispielnamen "Andre" und "Mia"):
  ```
  [T3 Main1] Andre: Play "Sol Ring" from Hand to Battlefield
  [T3 Main1] Andre: Tap "Sol Ring"
  [T3 Main1] Andre: Play "Arcane Signet" from Hand to Battlefield
  [T4 Combat] Mia: Declare "Thalia, Guardian of Thraben" as attacker
  ```
- Anzeige in einem einklappbaren Seitenpanel
- Undo-Button: Letzte Aktion rückgängig machen (State wird aus dem Log rekonstruiert oder der vorherige State wiederhergestellt)

---

## Modul 5: Boardstate-Snapshot & Export

### Boardstate-Snapshot (Schicht 2)
Dies ist das Kernstück des Projekts. Der Snapshot bildet ab, was ein ehrlicher Spieler am Tisch sehen würde – **aus der Perspektive des LLM-Spielers**.

Der Snapshot enthält (Beispielnamen: "Andre" = Mensch, "Mia" = LLM):

**Allgemein:**
- Aktueller Turn-Zähler
- Aktuelle Phase
- Wer am Zug ist (Name, nicht "Player X")

**LLM-Spieler (Mia) – eigene Informationen:**
- Life Total
- Battlefield: Alle Karten mit Status (tapped/untapped), Counters, Attachments, Oracle-Text. Verknüpfte Exile-Karten werden direkt bei der Eltern-Karte aufgeführt.
- Hand: Alle Karten mit Oracle-Text (er kennt seine eigene Hand)
- Graveyard: Alle Karten mit Oracle-Text. Falls eine Karte verknüpfte Exile-Karten hat, werden diese bei der Karte erwähnt (z.B. Gonti im Graveyard mit seinen geklaueten Karten).
- Command Zone: Commander mit Oracle-Text, ggf. Tax-Zähler
- Library: Nur Kartenanzahl (NICHT der Inhalt – hidden information!)
- Mana Pool (falls getrackt)
- Standard-Exil: Wird NICHT mitgeschickt (irrelevant für Spielentscheidungen)

**Menschlicher Spieler (Andre) – öffentlich sichtbare Informationen:**
- Life Total
- Battlefield: Alle Karten mit Status, Counters, Attachments, Oracle-Text. Verknüpfte Exile-Karten bei der Eltern-Karte aufgeführt.
- Hand: Nur Kartenanzahl (NICHT der Inhalt – hidden information!)
- Graveyard: Alle Karten mit Oracle-Text. Verknüpfte Exile-Karten bei der jeweiligen Karte erwähnt.
- Command Zone: Commander mit Oracle-Text
- Library: Nur Kartenanzahl

### Export-Format
- Strukturierter Text, gut lesbar für ein LLM
- **Prinzip: Nur Abweichungen vom Default erwähnen.** Untapped ist der Normalzustand → wird nicht annotiert. Nur TAPPED wird explizit geschrieben. Gleiches Prinzip gilt für andere Defaults (z.B. Karten ohne Counter brauchen keine "0 Counters"-Angabe).
- Vorschlag für das Format (kann iteriert werden):

```
=== MTG DUEL COMMANDER – BOARD STATE ===
Turn: 5 | Phase: Main 1 | Active Player: Mia (You)

--- YOUR STATUS (Mia) ---
Life: 18
Commander Tax: 0

Hand (3 cards):
  - Counterspell {U}{U} [Instant] — Counter target spell.
  - Island [Basic Land — Island]
  - Fact or Fiction {3}{U} [Instant] — Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.

Battlefield:
  - Talrand, Sky Summoner {2}{U}{U} [Legendary Creature — Merfolk Wizard] (2/2) — Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.
  - Drake Token [Token Creature — Drake] (2/2, Flying) — TAPPED
  - Banishing Light {2}{W} [Enchantment] — When Banishing Light enters the battlefield, exile target nonland permanent an opponent controls until Banishing Light leaves the battlefield.
    → hält im Exil: Thalia, Guardian of Thraben
  - Island x4 (1 tapped)
  - Sol Ring {1} [Artifact] — {T}: Add {C}{C}.

Graveyard:
  - Gonti, Lord of Luxury {2}{B}{B} [Legendary Creature — Aetherborn Rogue] (2/3) — When Gonti enters the battlefield, look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order. You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast that spell.
    → hält im Exil: 1 Karte (von Mia spielbar, verdeckt für Andre)
  - Ponder {U} [Sorcery] — Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.

Library: 87 cards

--- OPPONENT STATUS (Andre) ---
Life: 15
Commander Tax: 2

Hand: 4 cards (hidden)

Battlefield:
  - Winota, Joiner of Forces {2}{R}{W} [Legendary Creature — Human Warrior] (4/4) — TAPPED — Whenever a non-Human creature you control attacks, look at the top six cards of your library...
  - Mountain x2
  - Plains x3 (2 tapped)

Graveyard:
  - Lightning Bolt {R} [Instant] — Lightning Bolt deals 3 damage to any target.

Library: 82 cards
Commander Zone: Winota, Joiner of Forces (cast 2 times previously)

=== RECENT ACTIONS (last 5) ===
[T5 Upkeep] Mia: Untap all permanents
[T5 Draw] Mia: Draw a card
[T4 Combat] Andre: Attack with Winota, Joiner of Forces
[T4 Combat] Andre: Winota trigger — put Thalia onto battlefield tapped and attacking
[T4 Main2] Andre: Pass turn

=== ADDITIONAL NOTES FROM ANDRE ===
(Freitext-Feld, vom menschlichen Spieler befüllt)
```

### Export-Aktionen
- **"Copy Boardstate" Button:** Kopiert den Snapshot in die Zwischenablage
- **Textfeld-Anzeige:** Der Snapshot wird auch in einem Textfeld angezeigt (read-only), das bei jeder Änderung aktualisiert wird
- **Freitext-Feld:** Editierbares Textfeld unter dem Snapshot für Zusatzinfos des menschlichen Spielers (z.B. "Ich habe 2 blaue Mana offen, denk dran bevor du castest")

---

## Modul 6: Spiel-Setup

### Neues Spiel starten
1. **Spielernamen eingeben:** Frei wählbare Namen für beide Spieler (z.B. "Andre" und "Mia"). Diese Namen werden überall verwendet – im Action Log, im Boardstate-Snapshot, im Phase Tracker. KEINE generischen "Player 1"/"Player 2" Bezeichnungen. Namen sind für LLMs leichter zu verarbeiten und machen den Boardstate-Export eindeutiger.
2. Deck für Spieler 1 laden (Textdatei)
3. Deck für Spieler 2 laden (Textdatei)
4. Starting Life einstellen (Default: 20)
5. Münzwurf / Wer beginnt auswählen
6. Beide Libraries automatisch mischen
7. Starthand ziehen: 7 Karten pro Spieler
8. Mulligan (London Mulligan): "Mulligan"-Button mischt die Hand zurück und zieht erneut 7 Karten. Danach muss der Spieler pro genommenem Mulligan je eine Karte von der Hand unter die Library legen. Umsetzung: Nach dem Mulligan erscheint ein Hinweis "Lege X Karte(n) unter deine Library" – der Spieler zieht die Karten per Drag-and-Drop von der Hand auf die Library (oder Rechtsklick → "Unter die Library legen"). Kein hartes Erzwingen, nur der Hinweis.

---

## Nicht-funktionale Anforderungen

- **Performance:** UI muss flüssig reagieren, auch mit 20+ Karten auf dem Battlefield
- **Persistenz:** Aktuelles Spiel automatisch in einer lokalen Datei speichern (JSON), damit man nach Neustart weitermachen kann
- **Error Handling:** Scryfall-API nicht erreichbar? → Graceful degradation, Karten können manuell angelegt werden
- **Browser-Kompatibilität:** Muss in Edge (Chromium-basiert) funktionieren, Rest ist nice-to-have

---

## Zukunft (Phase 2+)

> **Single Source of Truth für alle ToDos und Phasen-Planung:**
> Siehe Claude Memory → `project_mtg_tracker.md`
>
> Dort werden Phase 2 (LLM-Integration), Phase 3 (Multiplayer) und eventuelle weitere Phasen gepflegt.
> Diese Datei hier (`mtg-board-tracker-phase1.md`) dokumentiert nur die Phase-1-Spec und -Grundsätze.

---

## Phase 1 — Zusammenfassung

Phase 1 ist **abgeschlossen** (2026-03-24). Alle oben genannten Features sind implementiert und getestet.

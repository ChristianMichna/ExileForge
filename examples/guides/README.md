# Beispiel-Guides

Guide-Dateien (`*.json`, Format `GuideFile` aus `packages/contracts`, siehe `guide/file`), die der
lokale Server beim Start einspielt, wenn sein Speicher sie noch nicht kennt. Der Installer bringt
diesen Ordner als `example-guides/` mit, damit die Guide-Seite ohne eigenen Lauf echte Guides zeigt.

- Jede Datei ist ein echter Guide mit den gespeicherten PoB-Ergebnissen, auf die seine Zahlen
  verweisen; nichts davon ist geschätzt oder von Hand gesetzt.
- Ein Guide zeigt Namen und Baum nur, wenn die Daten-Release der App die seines Laufs ist; sonst
  steht „Older game data“ dabei.
- Eine Datei, die sich nicht einspielen lässt, steht mit Grund im Log; der Server startet trotzdem.

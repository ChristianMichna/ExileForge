# @exileforge/economy

Marktpreise (F-14): Client für die öffentlichen Economy-Endpunkte von poe.ninja,
lokaler Cache, Abbildung auf Katalog-IDs und die Umrechnung für `economy.price`
(Vertrag: `packages/contracts/src/economy`). Keine Preise im Code; alles Weitere
steht in `config/economy/`.

```ts
const service = new EconomyService({ config, itemMap, client, books, dataReleaseId, catalogHas });
const { league, inCurrencyItemId, prices, freshness } = await service.price({ items });
```

## Quelle und Regeln (Stand der Provider-Doku, 25.11.2026)

- Nur die Economy-Endpunkte sind öffentlich unterstützt (Ligen, Exchange-Overview).
  Builds-, Charakter- und PoB-Endpunkte werden nie genutzt. Keine Garantie, keine
  Versionierung, Änderungen ohne Ankündigung sind möglich.
- HTTP-Cache beim Provider etwa 5 Minuten (ETag), PoE2-Daten stündlich aktualisiert.
  Der Client nutzt bedingte Anfragen (`If-None-Match`), die lokale Lebensdauer eines
  Preisbuchs ist `cacheTtlMinutes` (60).
- Anfragen laufen nacheinander mit Mindestabstand (`minRequestIntervalMs`), mit
  Timeout, gestreamtem Größenlimit und ohne Redirects (ein 3xx ist ein Fehler). Nach
  einem 429 wird bis `Retry-After` (sonst `rateLimitBackoffMs`) nichts gesendet. Ein Abruf (alle `exchangeTypes`) sind etwa 14 Anfragen pro
  Stunde und Liga.
- User-Agent identifiziert die App und nennt den vom Projektinhaber gewählten Kontakt
  (E-Mail, auf seinen ausdrücklichen Wunsch; kein Git-Link). Der Produktname kommt
  über `appName` aus der Config (Platzhalter `{appName}`), eine Umbenennung ändert
  nur dieses Feld.
- Der Provider rät Desktop-Apps, über ein eigenes Backend zu gehen. ExileForge ist
  lokal ohne Backend; das Volumen ist klein (siehe oben). Das ist eine bewusste
  Abweichung und bei Beanstandung neu zu entscheiden.
- Die Feldnamen der Antworten stammen aus der Doku; sie sind noch nicht gegen echte
  Antworten geprüft (der Entwicklungsumgebung fehlt der Zugriff). Tests nutzen
  erfundene Antworten. Eine Antwort, die nicht passt, ist ein Fehler
  (`invalid_response`), nie eine leere Preisliste.

## Ablauf

1. Liga: Anfrage oder erste Liga der Provider-Liste (aktuelle Challenge-Liga).
2. `getBook` (gleichzeitige Aufrufer teilen sich einen Abruf; ohne Liga und bei
   nicht abrufbarer Ligenliste gilt die Liga des zuletzt gespeicherten Buchs, als `stale`): gespeichertes Preisbuch jünger als die TTL → ohne Netz. Sonst Abruf aller
   Typen, Abbildung über `config/economy/item-map.json`, Speichern. Weniger als
   `minQuotes` brauchbare Preise gelten als unplausibel (`implausible_response`): das
   alte Buch bleibt. Lässt sich das frische Buch nicht speichern, kommt es trotzdem
   zurück, mit Warnung (`cache_error`). Schlägt der Abruf
   fehl und es gibt ein älteres Buch, kommt dieses als `stale` mit dem Fehler zurück;
   ohne Buch wird der Fehler geworfen.
3. `priceItems`: ein direkter Preis in der Referenzwährung ist `market`, jede
   Umrechnung über eine andere Währung ist `derived` aus den verwendeten
   Marktpreisen (schwächste Konfidenz), die Referenzwährung in sich selbst ist
   nicht bepreisbar („uncalibrated"), weil es keine Marktquote hat. Kein Preis → `uncalibrated` mit Grund, nie 0.

## Abbildung auf Katalog-IDs

`item-map.json` bildet Provider-IDs auf Katalog-IDs ab. Nur IDs, die im Katalog des
Daten-Release existieren, zählen; der Rest steht in `unmappedProviderItemIds`
(zusammen mit Zeilen ohne brauchbaren Preis und doppelten Zeilen). Die Datei ist
leer: Das Katalog-Release enthält noch keine Währungs-Items (PoB führt sie nicht;
die dat-Extraktion ist nicht freigegeben). Ohne Abbildung der Referenzwährung
scheitert der Abruf mit `reference_currency_unmapped`, und Preise bleiben
„uncalibrated". Der Einsatz in der App wartet daher auf diese Entscheidung.

## Konfidenz

Aus dem vom Provider gemeldeten Handelsvolumen mit Schwellen aus der Config
(`high`/`medium`, darunter `low`; ohne Volumen `low`).

## Noch nicht enthalten

- Preise von Uniques (Stash-Overview): Die Doku nennt die Währung von `primaryValue`
  dort nicht; das wird nicht geraten.
- Anbindung an den Server (`economy.price` als MCP-Werkzeug), Dateispeicherort der
  Caches (Aufrufer übergibt das Verzeichnis).

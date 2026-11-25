# @astrolabe/economy

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
  einem 429 wird bis `Retry-After` (sonst `rateLimitBackoffMs`) nichts gesendet. Ein Abruf (alle `exchangeTypes` und `uniqueTypes`) sind etwa 22 Anfragen pro
  Stunde und Liga.
- User-Agent identifiziert die App und nennt den vom Projektinhaber gewählten Kontakt
  (E-Mail, auf seinen ausdrücklichen Wunsch; kein Git-Link). Der Produktname kommt
  über `appName` aus der Config (Platzhalter `{appName}`), eine Umbenennung ändert
  nur dieses Feld.
- Der Provider rät Desktop-Apps, über ein eigenes Backend zu gehen. Astrolabe ist
  lokal ohne Backend; das Volumen ist klein (siehe oben). Das ist eine bewusste
  Abweichung und bei Beanstandung neu zu entscheiden.
- Die Feldnamen der Antworten stammen aus der Doku und wurden am 25.11.2026 einmal
  gegen echte Antworten gelesen (Ligen: `id`/`name`; Exchange: `core.primary`,
  `lines[].id/primaryValue/volumePrimaryValue`, `items[].id/name/category`). Die
  Tests nutzen weiter erfundene Antworten. Eine Antwort, die nicht passt, ist ein
  Fehler (`invalid_response`), nie eine leere Preisliste.

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
(zusammen mit Zeilen ohne brauchbaren Preis und doppelten Zeilen). Die Datei
wurde am 25.11.2026 aus einem Namensabgleich gebaut: Anzeigenamen der
poe.ninja-Exchange-Einträge (Liga Standard, alle `exchangeTypes`) gegen die
Börsen-Basen des Katalogs (Daten-Release `poe2-0.5.5.10+r2`), nur exakte und
eindeutige Treffer (329 Einträge, alle des damaligen Feeds; Referenzwährung `divine`).
`orb-of-extraction` hat zwei Katalog-Items gleichen Namens; genommen ist das mit dem
Tag `exchange_category:Incursion` (das handelbare, die Bench-Variante hat keine
Börsen-Kategorie). Einträge, die der Provider später ergänzt, landen in
`unmappedProviderItemIds`. Nach einem neuen Daten-Release den Abgleich wiederholen.
Fehlt die Referenzwährung im Katalog, scheitert der Abruf mit
`reference_currency_unmapped`, und Preise bleiben „uncalibrated".

## Konfidenz

Aus dem vom Provider gemeldeten Handelsvolumen mit Schwellen aus der Config
(`high`/`medium`, darunter `low`; ohne Volumen `low`).

## Unique-Preise

Aus dem Stash-Overview (`paths.uniqueOverview`, `uniqueTypes`). Die Zeilen tragen `id` (Zahl), `name`, `baseType`, `corrupted`, `primaryValue` und `listingCount`; `variant` fehlt, wenn es keine gibt (am 25.11.2026 einmal gegen eine echte Antwort der Liga Forbidden Rites gelesen). Die Doku nennt `primaryValue`
dort „Estimated value in the league's primary reference currency“; das Preisbuch nimmt dafür
`core.primary` der Exchange-Antworten, also die eigene Referenzwährung, und zeigt die Preise
als `market`. Der Server löst Name und Basis-Typ der Zeile über den Katalog zu einer
Unique-ID auf (`createUniqueResolver` in `apps/server`): über den Namen und den Namen
der Basis (der Provider führt eine Zeile je Basis; eine andere Basis gleichen Namens ist
ein anderes Item und bleibt unmapped). Ohne Basis-Typ löst nur ein eindeutiger Name auf. Zeilen einer Variante oder eines
korrumpierten Exemplars, unbekannte und mehrdeutige Namen sowie unbrauchbare Preise stehen
mit `unique:<id>` in `unmappedProviderItemIds`. Die Konfidenz kommt aus der Anzahl
Listings (`uniqueConfidence`, vorläufig). Eine leere Antwort (z. B. in einer Liga ohne Unique-Daten) ergibt keine Unique-Quotes; abgefragte Uniques
sind dann `uncalibrated` mit Grund. Schlägt der Abruf eines Unique-Typs fehl, schlägt
der ganze Refresh sichtbar fehl (stale-Fallback wie sonst), es gibt kein Buch ohne Uniques.

## Noch nicht enthalten

- Preise je Variante eines Uniques: Der Vertrag kennt nur die Unique-ID.
- Dateispeicherort der Caches (Aufrufer übergibt das Verzeichnis).

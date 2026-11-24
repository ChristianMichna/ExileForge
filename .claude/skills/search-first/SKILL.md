---
name: search-first
description: Recherche vor dem Bauen – vor neuem Code, neuer Abhängigkeit oder neuem Datenimport in ExileForge prüfen, ob PoB-PoE2, das MCP-SDK, ein npm-Paket oder ein bestehendes PoE-Community-Projekt es schon kann, dann übernehmen, erweitern oder selbst bauen. Verwenden beim Start eines Features, beim Hinzufügen einer Abhängigkeit oder bevor ein Parser/Konverter/Hilfsmodul neu geschrieben wird.
---

<!-- Adaptiert aus everything-claude-code (skills/search-first),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md.
     Entfernt: Researcher-Subagent, PyPI, globale Skill-Kataloge. -->

# Erst suchen, dann bauen

## Reihenfolge der Quellen

1. **Dieses Repo** – `rg` in `packages/`, `apps/`, `services/`, `docs/`.
2. **Path of Building PoE2** (Submodul bzw. GitHub) – Rechenlogik, Datendateien
   (Tree, Gems, Mods, Basen, Uniques), PoB-Code-Format, `HeadlessWrapper.lua`.
   Was PoB rechnet, rechnen wir nicht nach.
3. **GGG Developer Docs** – `.build`-Format, offizielle Schnittstellen.
4. **Bekannte Community-Projekte** als Vorbild, nicht blind als Abhängigkeit:
   `pob-mcp` (PoB headless als MCP), `poe2-build-forge` (`.build`-Konverter),
   poe.ninja (Preise, Build-Planner-Export).
5. **npm** – nur gepflegte Pakete mit passender Lizenz (MIT/Apache/BSD/ISC).
6. **MCP-SDK, `.mcpb`-Doku und Claude-Code-Plugin-Doku** für Erweiterung,
   Tools und Prompts.

## Bewerten

| Kriterium | Frage |
|---|---|
| Passt es? | Deckt es PoE2 ab (nicht nur PoE1)? Aktuelle Spielversion? |
| Pflege | Letzter Release, Reaktion auf Patches? |
| Lizenz | Mit unserer Lizenz und mit Verteilung vereinbar? GGG-Assets? |
| Kosten | Native Abhängigkeiten, Größe, postinstall-Skripte? |
| Daten | Wo kommen Zahlen her? (Regel: nur PoB/gamedata/market/derived) |

## Entscheiden

- **Übernehmen**: passt genau, gepflegt, Lizenz ok.
- **Erweitern/umhüllen**: gute Basis, dünne eigene Schicht.
- **Selbst bauen**: nichts Passendes – aber mit dem Gelernten; Fundstellen
  im PR nennen.

## Ergebnis festhalten

Im PR-Text kurz: was gesucht, was gefunden, warum übernommen/verworfen.
Bei weitreichender Wahl eine ADR (Skill `architecture-decision-records`).
Fremdcode, der übernommen wird, mit Lizenzhinweis versehen.

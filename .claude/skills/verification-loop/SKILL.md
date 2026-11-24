---
name: verification-loop
description: Prüfschleife vor jedem PR oder nach einer größeren Änderung in ExileForge – Typecheck, Lint, Tests, Build, Lua-Worker, Projektregeln (Zahlenherkunft, Zugangsdaten) und Diff-Durchsicht, mit PASS/FAIL-Bericht. Verwenden vor dem Öffnen oder Aktualisieren eines PRs oder wenn Qualitäts-Gates bestätigt werden sollen.
---

<!-- Adaptiert aus everything-claude-code (skills/verification-loop),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md. -->

# Prüfschleife

Reihenfolge einhalten; bei FAIL in Phase 1–3 zuerst beheben. Nach einem
Fehlschlag nur das Fehlgeschlagene erneut laufen lassen, nicht alles.
Existiert ein Skript noch nicht (frühe Projektphase), Phase als
„NICHT VORHANDEN" melden, nicht als PASS.

## Phase 1 – Typen

```bash
set -o pipefail
pnpm typecheck 2>&1 | sed -n '1,40p'
```

## Phase 2 – Lint/Format

```bash
set -o pipefail
pnpm lint 2>&1 | sed -n '1,40p'
pnpm exec prettier --check . 2>&1 | sed -n '1,20p'
```

## Phase 3 – Tests

```bash
set -o pipefail
pnpm test 2>&1 | tail -40          # gezielt: pnpm --filter <paket> test -- <datei>
```

Golden-Tests gegen PoB (falls vorhanden) gehören dazu; sie laufen nur mit
installiertem LuaJIT. Fehlt es, als „ÜBERSPRUNGEN (kein LuaJIT)" melden.

## Phase 4 – Build

```bash
set -o pipefail
pnpm build 2>&1 | tail -20
```

## Phase 5 – PoB-Worker (nur wenn `services/pob-worker` geändert)

```bash
luajit -v
# Smoke-Test der Bridge, sobald vorhanden, z. B.:
# echo '{"cmd":"ping"}' | luajit services/pob-worker/bridge.lua
git -C services/pob-worker/PathOfBuilding status --porcelain   # muss leer sein
```

## Phase 6 – Projektregeln

```bash
# Abo-Regel (CLAUDE.md Regel 4): App ruft nie Claude auf, keine Zugangsdaten
git diff origin/main... -- apps packages | grep -nE "^\+.*((spawn|execFile|exec)\(.*claude|@anthropic-ai/(sdk|claude-agent-sdk)|\.claude/\.?credentials|ANTHROPIC_API_KEY|oauth|keychain)" || true
# Stille Ersatzwerte auf Zahlen
git diff origin/main... | grep -nE '^\+.*(\?\?\s*0\b|\|\|\s*0\b|catch\s*\(\w*\)\s*\{\s*\})' || true
# Debug-Ausgaben
git diff origin/main... | grep -nE '^\+.*console\.log' || true
```

Treffer einzeln bewerten. Bei Änderungen an Zahlenpfaden zusätzlich den
Agent `pob-number-auditor` laufen lassen; bei Main/IPC/Prozessstart
`electron-security-reviewer`.

## Phase 7 – Diff-Durchsicht

```bash
git diff --stat origin/main...
```

Unbeabsichtigte Änderungen, generierte Dateien, Lockfile-Sprünge,
fehlende Doku (Architektur, Datenmodell, ADR) prüfen.

## Bericht

```
PRÜFBERICHT
===========
Typen:       PASS/FAIL/NICHT VORHANDEN
Lint:        PASS/FAIL/NICHT VORHANDEN (n Warnungen)
Tests:       PASS/FAIL (x/y), PoB-Golden: PASS/FAIL/ÜBERSPRUNGEN
Build:       PASS/FAIL/NICHT VORHANDEN
PoB-Worker:  PASS/FAIL/NICHT BETROFFEN
Regeln:      PASS/FAIL (Funde)
Diff:        n Dateien

Gesamt:      BEREIT / NICHT BEREIT für PR
Offen:
1. …
```

Im Spiel getestete Punkte (z. B. `.build`-Import im Build Planner) getrennt
ausweisen: lokal geprüft ≠ im Spiel bestätigt.

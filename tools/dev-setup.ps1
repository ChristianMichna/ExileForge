# Windows counterpart of tools/dev-setup.sh: Node deps and the Playwright
# browser for working on ExileForge natively on Windows (PowerShell 5+).
# Headless PoB on Windows needs a luajit.exe next to PoB's DLLs; see
# docs/pob-headless.md (or use WSL with tools/dev-setup.sh).
#
#   powershell -ExecutionPolicy Bypass -File tools\dev-setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($text) { Write-Host "`n==> $text" }

Step 'Node'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js $(Get-Content .nvmrc) is required: https://nodejs.org"
}
$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt [int](Get-Content .nvmrc)) { throw "Node $(node -v) is too old; need $(Get-Content .nvmrc)+." }
node -v

Step 'pnpm'
$want = node -p 'require("./package.json").packageManager.split("@")[1]'
$have = ''
if (Get-Command pnpm -ErrorAction SilentlyContinue) { $have = pnpm -v }
if ($have -ne $want) {
  corepack enable
  if ($LASTEXITCODE -ne 0) { npm install -g "pnpm@$want" } else { corepack prepare "pnpm@$want" --activate }
  if ($LASTEXITCODE -ne 0) { throw 'pnpm setup failed' }
}
pnpm -v

Step 'Dependencies'
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }

Step 'Playwright Chromium'
pnpm --filter '@exileforge/web' exec playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'playwright install failed' }

Step 'Ready'
Write-Host 'pnpm check   typecheck, lint, format, tests, build'
Write-Host 'pnpm e2e     Playwright tests (screenshot baselines come from Linux CI; see docs/dev-tooling.md)'

# Startet Frontend + Backend dieses Checkouts auf abweichenden Ports, damit
# eine zweite, unabhaengige Instanz des SelfManaged-Repos (z.B. der
# Testserver-Checkout unter C:\dev\selfmanaged) parallel zur primaeren
# Dev/Test-Instanz (Frontend :5173, Backend :3002) laufen kann, ohne dass sich
# die Ports ueberlagern. Muster wie im portfolio-app-Repo (dort Frontend
# :5175 statt :5173, eigener Backend-Port), siehe vite.config.ts.
#
# Nutzung: .\scripts\dev-secondary-instance.ps1 [-FrontendPort 5176] [-BackendPort 3003]
#
# Eigene sqlite-DB (dev.db) liegt ohnehin im jeweiligen Checkout-Ordner und
# kollidiert dadurch nicht mit anderen Instanzen.

param(
    [int]$FrontendPort = 5176,
    [int]$BackendPort = 3003
)

$root = Split-Path -Parent $PSScriptRoot

Write-Host "Backend  -> http://localhost:$BackendPort (dev.db)"
Write-Host "Frontend -> http://localhost:$FrontendPort"

$backendCmd = "cd `"$root\server`"; npx cross-env DB_FILE=dev.db PORT=$BackendPort ts-node-dev --respawn --transpile-only src/index.ts"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd

Set-Location $root
npx cross-env VITE_DEV_API_PORT=$BackendPort vite --port $FrontendPort --strictPort

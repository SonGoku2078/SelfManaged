# Desktop: Linux-Client (Pop!_OS + Omarchy/Arch) inkl. Release-Pipeline

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: Installation auf Pop!_OS + Omarchy) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-02 |

> Orchestrator-Log:
> - 2026-10-02 gestartet (User-Wunsch: Fat Client für Pop!_OS und Omarchy) → /req-engineer
> - 2026-10-02 requirements-done (Issue #110, AC1–AC7) → /architect
> - 2026-10-02 architecture-done → /developer
> - 2026-10-02 implementation-done → /test-designer
> - 2026-10-02 testdesign-done → /test-manager
> - 2026-10-02 defects-open: latest-linux.yml ohne .pacman (Auto-Update Arch) → /developer → behoben
> - 2026-10-02 gate-go → /cicd-engineer: PR #111 gemergt, Tag `desktop-v1.3.4`

## 1. Requirements

- **GitHub Issue:** [#110](https://github.com/SonGoku2078/SelfManaged/issues/110)
- **Zielsysteme:** Pop!_OS (Ubuntu/Debian-Basis, apt) · Omarchy (Arch-Basis, pacman, Hyprland/Wayland).
- **ACs:** Pakete am `desktop-v*`-Release (AC1), deb-Install+Start Ubuntu (AC2), pacman-Install+Start Arch (AC3), Auto-Update (AC4), Wayland + Startmenü-Icon (AC5), Windows unverändert/keine Release-Kollision (AC6), PR-Check für `electron/**` (AC7).
- **Nozbe-Referenz:** N/A (Plattform/Distribution).

## 2. Architektur

- **Paketformate (electron-builder 24, x64):**
  - `.deb` → Pop!_OS. Installiert nach `/opt/SelfManaged`, `/usr/bin/selfmanaged`, `chrome-sandbox` SUID (nötig auf Ubuntu-24.04-Basis wegen AppArmor-userns-Sperre).
  - `.pacman` → Omarchy. Abhängigkeiten explizit auf Arch-Repo-Pakete gesetzt (Builder-Default enthält `http-parser`/`libappindicator-gtk3`, die nicht in den offiziellen Repos sind).
  - `.AppImage` → universell ohne Installation (Arch braucht `fuse2`).
- **Auto-Update:** electron-updater 6.8 wählt per `resources/package-type` den Deb-/Pacman-/AppImage-Updater; Feed `latest-linux.yml` am selben Release wie Windows (`make_latest` aus dem Windows-Job). Builder 24 trägt das `.pacman` nicht in den Feed ein → Pipeline ergänzt sha512/size.
- **Wayland:** `ozone-platform-hint=auto` (native Wayland unter Hyprland/GNOME/COSMIC, sonst X11). Fenster-Icon unter Linux aus `resources/icon.png` (`public/icon-512.png`, erzeugt von `scripts/generate-icons.mjs`).
- **Pipeline:** eigener Workflow `desktop-linux.yml` (Tag `desktop-v*`, PR auf `electron/**`, manuell). Release-Job wartet, bis der Windows-Workflow das Release angelegt hat, und hängt dann an (`gh release upload --clobber`) — keine parallele Release-Anlage.
- **Standard-Server** für frische Installationen: PROD-Appwrite-Site statt altem LAN-Server (bestehende `config.json` hat Vorrang).

## 3. Implementierung

Branch `feat/linux-desktop-client`: `electron/package.json` (Linux-Ziele, deps, Icon, Autor/Beschreibung für deb), `electron/src/main.ts` (+`main.js`), `.github/workflows/desktop-linux.yml`, `scripts/generate-icons.mjs`, `public/icon-512.png`.

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Build erzeugt AppImage + deb + pacman; `latest-linux.yml` listet alle drei | AC1, AC4 |
| TF-2 | Ubuntu 24.04: `apt install ./*.deb` löst Abhängigkeiten, `.desktop` + SUID-Sandbox vorhanden, App startet unter Xvfb (startup.log) | AC2, AC5 |
| TF-3 | Arch (`archlinux:latest`): `pacman -U` ohne fehlende Abhängigkeit, `.desktop` vorhanden, App startet | AC3, AC5 |
| TF-4 | AppImage startet (extract-and-run) | AC1 |
| TF-5 | Update-Check erreicht den Release-Feed (Log) | AC4 |
| TF-6 | Windows-Workflow unverändert; Release-Job wartet auf Windows-Release | AC6 |
| TF-7 | PR-Lauf baut + smoked ohne Veröffentlichung | AC7 |

## 5. Testausführung & Gate

- Lauf 1: TF-1 **FAIL** — `.pacman` fehlte im Update-Feed (Defekt, Auto-Update Arch). Fix: Feed-Ergänzung im Workflow.
- Lauf 2 (PR #111): TF-1–TF-4, TF-7 **PASS**; TF-5 PASS (Updater fragt `…/desktop-v1.3.3/latest-linux.yml` ab — 404 erwartet, Linux-Feed gibt es erst ab 1.3.4).
- Nicht automatisiert: echte Wayland-Session (Hyprland) und Auto-Update-Installation — Nachprüfung durch User auf Omarchy/Pop!_OS.
- **Gate: GO.**

## 6. CI/CD & Deployment

- PR #111 → master. Tag `desktop-v1.3.4` → `desktop-exe.yml` (Windows) + `desktop-linux.yml` (Linux) → ein Release mit allen Paketen.

### Installation

**Pop!_OS:**
```bash
# SelfManaged-<version>-amd64.deb vom Release laden, dann:
sudo apt install ./SelfManaged-*-amd64.deb
```

**Omarchy (Arch):**
```bash
# SelfManaged-<version>-x64.pacman vom Release laden, dann:
sudo pacman -U SelfManaged-*-x64.pacman
```

Start über den App-Launcher („SelfManaged") oder `selfmanaged`. Updates kommen automatisch (Passwortabfrage für die Paketinstallation).

# LEANNOVA Layout Planner – Version 2 (Teststand)

Stand: 09.10.2026. Getrennter Testbuild, keine Änderung an LP-01/F12.

## Einstieg

- Browser: https://freesewuebbo.github.io/trimble-cockpit/layout-planner-v2.html?build=V2
- Eigenes Trimble-Manifest: https://freesewuebbo.github.io/trimble-cockpit/manifest-lp-v2.json
- Bestehende Version: https://freesewuebbo.github.io/trimble-cockpit/manifest-lp-01.json (unverändert).

## Status je Anforderung

| Nr. | Anforderung | Entwicklungsstand | Noch erforderlich |
|---|---|---|---|
| A01 | Mehrere IFC-Fachmodelle | Implementiert, noch nicht vollständig getestet | Test mit 4 realen Fachmodellen, Einheiten/Georeferenzierung |
| A02 | Zeichnen | Implementiert, noch nicht vollständig getestet | 2-Klick-Quader/Wände/Böden und numerische Maße im Browser prüfen |
| A03 | Auswahl/Gruppierung | Teilweise implementiert | Rechteckselektion, Gruppen-Unsichtbarkeit und Einzelobjektwahl aus Gruppen vertiefen |
| A04 | Verschieben/Drehen/Skalieren | Teilweise implementiert | Nichtuniformer IFC-Skalierungsexport und Gruppen-Strecken im Trimble-Rundlauf verifizieren |
| A05 | Ausrichten/Fangen/Abstände | Teilweise implementiert | Kanten-/Mittelpunktsnapping fehlt |
| A06 | Kopieren/Reihenbildung | Teilweise implementiert | Rechteckraster-Anordnung und Einfüge-Puffer fehlen |
| A07 | Objektbibliothek | Teilweise implementiert | Lokale Standardobjekte, Modul-Speichern/-Laden vorhanden; Firmenserver fehlt |
| A08 | Messen/Live-Maße | Teilweise implementiert | 2-Punkt-3D-Messung und Live-Zeichenmaße vorhanden; echte Abstands-/Kantenmessung erweitern |
| A09 | Farbe | Teilweise implementiert | LP-Anzeigefarben; neuer IFC-Ergänzungsstil vorbereitet, Alt-IFC-Farbexport ungeprüft |
| A10 | Sichtbarkeit/Schnitte | Teilweise implementiert | Modell/Klassen/Objektsichtbarkeit, globale X/Y/Z-Ansichtsschnitte; 6-seitige Schnittbox fehlt |
| A11 | Löschen | Teilweise implementiert | Löschen in LP und Undo; sicherer IFC-Export mit Löschungen derzeit gesperrt |
| A12 | Getrennter Mehrfach-IFC-Rückexport | Implementiert, noch nicht vollständig getestet | Web-ifc-Öffnungscheck; Geometrie-Rundlauf mit 4 Modellen plus Ergänzungs-IFC |
| A13 | Projekt-Ordner/Versionierung | Implementiert, noch nicht vollständig getestet | Root-Ordner Layout-Planner, gemeinsame Zeitversionskennung; reale Trimble-API prüfen |
| A14 | Große Punktwolken E57/VPN | Technisch blockiert | Firmen-HTTPS-Tileserver/LOD-Stream und E57-Konvertierungsweg erforderlich |
| A15 | Intuitive Menüs | Teilweise implementiert | Werkzeuggruppen, 3D-Mitte, Eigenschaften rechts, Undo/Redo/Suche; Usabilitytest |

**Hinweis:** Implementiert bedeutet Code erstellt und im Repository verknüpft, nicht bereits in Deinem Browser/Trimble getestet.

## Testszenarien T01–T18

- **Code-/Strukturprüfung vorbereitet:** eigenes GitHub Actions Workflow-Skript `.github/workflows/layout-planner-v2-check.yml` für JS-Syntax und V2-Dateiverweise; Ausführung/Ergebnis noch nicht bestätigt.
- **Funktionale Live-Prüfung:** T01–T18 in dieser neuen Version **noch nicht durchgeführt**, daher **kein Test als bestanden ausgewiesen**.
- **T16:** abhängig von Firmenserver/Webdienst, derzeit blockiert.
- **T17:** Revit-Integration noch nicht überprüft, Revit-Testumgebung erforderlich.
- **T18:** Bestandscode F12 unangetastet, realer Regressionstest nach V2-Veröffentlichung steht noch aus.

## Technische Komponenten

- **Three.js, OrbitControls, TransformControls:** Darstellung und Transformation.
- **web-ifc 0.0.77:** IFC2X3-/IFC4-Lesen, 3D-Geometrie, Rückimport-Prüfung.
- **lp-v2-app.js:** Mehrmodell-Verwaltung, lokale Objektbibliothek, Gruppen, Zeichnen, Projektzustand.
- **lp-v2-step.js:** IFC-Änderungsdateien pro Ausgangsmodell inkl. IFC-Platzierung und Map-Scaling.
- **lp-v2-supplement.js:** eigenständige IFC2X3-Datei für neue Quader/Module, Stilfarben.
- **index-lp-v2.html:** Trimble-Multi-IFC-Launcher, Workspace-API und authentifizierte Dateidownloads.
- **lp-v2-trimble-upload.js:** getrennte Konzeptdateien in neuem/identifiziertem Projekt-Root-Ordner `Layout-Planner`, create-only.
- **lp-trimble-source-f12.js:** IFC-Rohdatei via signierten Core API Download statt TRB8-Cache.

## Noch erforderliche Freigaben/Voraussetzungen

1. **Trimble Connect:** Workspace-Berechtigung `accesstoken`, Core API Dateilesen/-schreiben und Ordneranlage in einem Testprojekt; V2-Manifest hinzufügen.
2. **Punktwolken:** VPN-erreichbarer HTTPS-Tile-Dienst (nicht SMB im Browser), einmalige E57-zu-Tiles-Aufbereitung, CORS/Authentifizierung, Metadaten zu Koordinatensystem und Einheiten.
3. **Revit:** Testimport und referenzierende Verknüpfung der V2-Fachmodelle in Revit.
4. **Georeferenzierung:** IFC-Koordinaten und Längeneinheiten gegen reale Fachmodelle prüfen.
5. **Browser:** Geometrie-/Speichertest mit realen großen Modellen; keine pauschale Leistungszusage.

## Sicherheit / Versionstrennung

Alle V2-Dateien liegen unter separaten Namen `layout-planner-v2.html`, `lp-v2-*.js`, `index-lp-v2.html`, `manifest-lp-v2.json`. Die alten `index-lp-01.html`, `manifest-lp-01.json` und `layout-planner-lp-01f12.html` wurden nicht überschrieben.

Die Rückübertragung verwendet nur neue Dateinamen `*_LP_V002_<Zeitkennung>.ifc`. Existierende Zieldateinamen werden vor dem Upload geprüft; eine Datei kann nie gezielt überschrieben werden. Browserdialog zur Übertragung erforderlich. Keine Auslieferung als abgeschlossene produktive Version.

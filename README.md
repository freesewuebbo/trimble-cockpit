# LEANNOVA Trimble Connect Maschinen-Cockpit – PoC

PoC für ein objektbezogenes Maschinen-Cockpit im Trimble Connect 3D Viewer.

## Live-URL

Nach Aktivierung von GitHub Pages:

- Cockpit: https://freesewuebbo.github.io/trimble-cockpit/
- Manifest: https://freesewuebbo.github.io/trimble-cockpit/manifest.json

## Dateien

- `index.html` – Cockpit und Trimble Workspace API
- `data.csv` – Testdaten / spätere Maschinenkennzahlen
- `manifest.json` – Custom Capability für Trimble Connect
- `.nojekyll` – verhindert Jekyll-Verarbeitung bei GitHub Pages

## Trimble Connect einrichten

1. Projekt öffnen.
2. Einstellungen → Apps und Funktionen.
3. Benutzerdefiniert hinzufügen.
4. Diese URL eintragen:
   `https://freesewuebbo.github.io/trimble-cockpit/manifest.json`
5. Hinzufügen.
6. 3D Viewer öffnen.
7. LEANNOVA Maschinen-Cockpit öffnen.
8. Maschinenobjekt anklicken.

## Objekt-ID mit Daten verknüpfen

Beim Anklicken zeigt das Cockpit die externe Objekt-ID. Diese ID in `data.csv` statt `DEFAULT` bzw. als neue Zeile eintragen.

Beispiel:

```csv
object_id;machine_name;status;utilization_pct;quality_pct;capacity_h;quality_issues;updated_at;history
DEINE_ECHTE_OBJEKT_ID;BAZ 01;Produktion;82;97.1;116;4;2026-10-05 06:00;68|71|74|79|76|80|82
```

Für echte Unternehmensdaten später bitte nicht öffentliches GitHub Pages verwenden, sondern einen freigegebenen internen/Cloud-Host.

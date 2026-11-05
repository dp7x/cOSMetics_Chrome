<div align="center">
  <img width="440" height="280" alt="image" src="https://github.com/user-attachments/assets/74690435-e1d8-4a6d-8b86-9c12bbcc4f05" />

  # cOSMetics for iD 2.02

  Mapping tools for OpenStreetMap
</div>

<hr>

## Overview

cOSMetics for iD is a Chrome extension for the OpenStreetMap iD editor. It brings together custom backgrounds, building drawing and Overture assistance, changeset comments, mapping grids, tag review and geometry simplification.

This repository contains the Chrome version. The Firefox version is maintained in a [separate repository](https://github.com/dp7x/cOSMetics_Firefox).

## Features

### 🗺️ Backgrounds — Custom layers management

Save background names and URL templates in the popup, then choose a layer from a dedicated panel inside iD's custom background dialog. Use only imagery whose terms permit OpenStreetMap mapping.

### 🏠 Bricks — Overture buildings assistant

* **Overture outlines:** Enable the optional controls and, at zoom 18 or higher, click **Load area**. Select an outline and press **A** or click **Add (A)** to add an individual building. Moving the map does not load more buildings automatically.
* **Three-click drawing:** Click **Draw** or press **4**. Place the first corner, move the mouse to orient and size a square, then click again to fix its orientation. Adjust the rectangle and finish with a third click. The new `building=yes` outline remains selected; **Esc** cancels an unfinished drawing. A reminder asks you to specify the exact building type in the properties and add other tags when known.
* **Snapping:** The first corner and the square's side corners snap to existing building corners and walls, helping draw attached buildings with shared nodes.
* **Tagging reminder:** After drawing a building or adding one from Overture, the panel reminds you to specify the exact building type and other tags when known.
* **Review:** Overture candidates overlapping OSM buildings already loaded in iD are hidden or blocked. Check every building against imagery and existing data, correcting geometry and tags before uploading.

### 💡 OSMradamus — Changeset comment suggester

* **Descriptive comments:** In iD's save dialog, click **OSMradamus** to summarise created and modified objects, for example:  
  `Created trees, woods, buildings, farmlands + modified highways in Roma area`
* **Relevant categories:** Shows up to four categories for creations and four for modifications, ordered by object count and then geometry complexity. Area names come from iD's location panel or Nominatim.
* **Persistent hashtag:** Configure a hashtag to prefill iD's standard hashtag field, including when writing comments manually. It stays saved locally until changed or cleared; other hashtags are preserved and duplicates avoided.

Always review the suggested comment before uploading.

### ▦ Grids — Mapping grids GeoJSON exporter

Download a grid centred on the current OpenStreetMap view, with 1–10 cells per side and 100–1000 metres per cell. When iD is ready for editing, the grid also appears automatically as custom data; existing custom data is replaced only after confirmation. Otherwise, import the downloaded GeoJSON manually. Grid parameters are remembered locally.

The grid is a reference layer and does not create OpenStreetMap objects.

### 🔎 Sensei — Tag reviewer

Import an Overpass JSON or GeoJSON file containing OSM object IDs, then review the objects one at a time in iD. Enter search tags and replacement tags, one `key=value` pair per line: **Fix** applies the correction and advances, **Skip** moves on, and **Previous** returns to the preceding object.

Leave replacement tags empty to remove matching tags, or leave both fields empty for manual review. Forward navigation checks current tags and skips objects that no longer match. Unrelated tags are preserved.

Prepare the file externally, for example with [Overpass Turbo](https://overpass-turbo.eu/); Sensei does not run Overpass queries. Review each correction and upload through iD as usual.

### ✂️ Ockham — Geometry simplifier

Simplify an eligible selected line or polygon using a tolerance in metres, adjustable directly in the floating panel. Click **Preview** or press **5** to inspect the proposed geometry, then click **Apply** or press **0** to confirm.

Endpoints and protected nodes, such as tagged or shared nodes, are retained based on the data loaded in iD. Some relation geometries are excluded. The panel's **Undo** discards a preview or reverses the simplification while it remains the latest operation; iD's normal undo is also available.

**Panel activation:** Bricks, Sensei and Ockham start disabled whenever iD is opened or reloaded. Enable them from the popup for the current tab; positions and tool preferences remain saved.

**Compact interface:** Popup sections collapse independently, remember their state and keep **Save** visible. Bricks, Sensei and Ockham use collapsible floating panels with light/dark styling; drag their headings to reposition them, including over iD's sidebar.

### 🌐 Languages

English, Italian, Slovak, German, French and Spanish follow the browser's language; unsupported languages fall back to English. The **Comments in English** option forces English for suggested comments without changing the interface language.

**Network access:** Backgrounds use their configured tile services. Area-name resolution may contact Nominatim. Loading an Overture snapshot requests its public catalog and tiles, revealing the requested area to those servers. Panning a loaded snapshot does not fetch additional Overture tiles.

## Installation

To load the repository version in Chrome:

1. Download or clone this repository and extract it into a folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Optionally pin **cOSMetics for iD** to the toolbar.

The bundled `dist/overture.js` is included, so no build step is required to install. After updating the files, reload the extension and refresh any open iD tabs.

## Usage

### Backgrounds

1. Open the extension popup, click **Add new layer**, enter a name and URL template, then **Save settings**.
2. In iD, open **Background settings**, then **Edit custom background** (three dots).
3. Choose a saved background from the extension's panel.

### Bricks

Enable the building controls in the popup. Use **Load area** for Overture outlines, or **Draw (4)** for three-click drawing. Check each building before uploading; additions can be undone through iD.

### 💡 Using OSMradamus

1. Make your edits in iD and click **Save**.
2. Click **OSMradamus** to generate a comment from your edits and the current area.
3. Review and edit the comment before uploading.

> **Tip:** Press `Ctrl+Shift+L` in iD to open the location panel and help identify the area name.

## Keyboard Shortcuts

With map focus and no text field active:

| Key | Action |
| --- | --- |
| **4** | Start Bricks drawing |
| **5** | Preview Ockham simplification |
| **0** | Apply Ockham preview |

## Supported Object Types

The `MASTER_TAG_RULES` matrix in `content.js` covers master tags such as `landuse`, `natural`, `building`, `highway`, `waterway`, `amenity`, `historic`, `tourism` and `route`. Common values have dedicated labels; modified highways use their general category. A relation's `type` is used only when no more descriptive known master tag is present.

An unknown future key can be included by its original name when it is the only descriptive candidate after filtering supplementary tags. Multiple ambiguous unknown keys are skipped.

`comment-matrix.json` preserves the reference configuration. To change the extension's behavior, update `MASTER_TAG_RULES` and the corresponding `tag_*` messages in `_locales/{en,it,sk,de,fr,es}/messages.json`.

If you edit `src/overture.js`, rebuild the bundled overlay with:

```bash
npm ci
npm run build
```

## Contributing

Suggestions, bug reports and pull requests are welcome on the [GitHub repository](https://github.com/dp7x/cOSMetics_Chrome). You can also [contact me on OpenStreetMap](https://www.openstreetmap.org/messages/new/dp7).

## License

The extension's code is licensed under the [MIT License](LICENSE). Bundled dependencies retain their own notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Overture building data is separate from the code license. Overture lists its buildings theme under **ODbL 1.0**, with source attributions including Microsoft Global ML Building Footprints, Google Open Buildings and OpenStreetMap contributors. See [Overture's attribution and licensing page](https://docs.overturemaps.org/attribution/). Credits and the licensing link are displayed in the map control; OpenStreetMap-sourced candidates are excluded from this overlay.

## Credits

© 2024–2026 **dp7** [@OpenStreetMap](https://www.openstreetmap.org/user/dp7)

<div align="center">
  <img width="440" height="280" alt="image" src="https://github.com/user-attachments/assets/74690435-e1d8-4a6d-8b86-9c12bbcc4f05" />

  # cOSMetics for iD

  Custom Layers, Building Assistant & OSMradamus (comment suggester)
</div>

<hr>

## Overview

cOSMetics for iD is a Chrome extension for the OpenStreetMap iD editor. It adds quick access to custom background layers, assists with reviewing and adding individual Overture buildings, and suggests descriptive changeset comments with **OSMradamus**.

Developed for Chrome. Firefox compatibility has not been verified.

## Features

### 🗺️ Custom Background Layers

* **Quick Access:** Choose saved backgrounds from a dedicated panel within iD.
* **One-Click Application:** The extension fills the custom background URL and confirms your selection.
* **Customizable Layers:** Configure a name and URL template for each background in the extension popup.

### 🏠 Building Assistant

* **Optional Controls:** Enable the compact Overture control from the popup; it is disabled by default. The wide panel follows the browser’s light/dark preference. Drag its heading to reposition it; the position is saved locally. Double-click the heading to restore the default position.
* **Area Snapshot:** At zoom 18 or higher, load buildings for the visible area with a 20% margin on each side. Moving or zooming the map does not request additional buildings; another click replaces the snapshot.
* **Individual Addition:** Select an outline and press **A** or click **Add (A)** to create a `building=yes` way with a source tag. The accepted outline disappears from the overlay.
* **Existing Buildings:** Candidates overlapping OSM buildings already loaded in iD are hidden or blocked. Review every proposed building against imagery and correct its geometry and tags before uploading. Geometries with holes or multiple polygons must be drawn manually.

### 💡 OSMradamus (comment suggester)

* **Automatic Analysis:** Reads the OSMChange file and distinguishes created and modified objects. Only descriptive master tags are used; supplementary information such as `name`, `source` and `leaf_type` is ignored.
* **Specific Categories:** Common values receive specific names, while other values use the master tag's general category. Moved untagged nodes are classified through their parent ways already loaded in iD; otherwise, the suggestion uses “geometries”.
* **Smart Area Detection:** Uses iD's location panel or resolves coordinates through Nominatim.
* **One-Click Generation:** Adds a **OSMradamus** button to the save dialog, producing comments such as:
  `Created trees, woods, buildings, farmlands + modified highways in Roma area`
* **Persistent Hashtag:** Set a hashtag in the popup to prefill iD’s standard hashtag field when you open the save dialog, even if you write the comment manually. It is saved automatically on this device until you clear it. Other hashtags are preserved and duplicates are avoided; the suggested comment contains no appended hashtag.
* **Sorting:** Shows up to four categories separately for creations and modifications, ordered by object count and then by total geometry points. “Other improvements” is added only when categories are omitted.

### ▦ Mapping Grid

* Download a GeoJSON grid centred on the current OpenStreetMap view: 1–10 cells per side and 100–1000 metres per cell. Then enter edit mode in iD and drag the downloaded file onto the map. Grid parameters are remembered locally.
* The grid is a visual aid; generating it does not add objects to OpenStreetMap.

**Compact popup:** Each feature has a collapsible section. Open/closed states are remembered locally and the Save button remains visible while the contents scroll.

### 🌐 Languages

English, Italian, Slovak, German, French and Spanish follow the browser's language; unsupported languages fall back to English. The **Comments in English** option forces English for suggested comments without changing the interface language.

**Network access:** Backgrounds use their configured tile services. Area-name resolution may contact Nominatim. Loading an Overture snapshot requests its public catalog and tiles, revealing the requested area to those servers. Panning a loaded snapshot does not fetch additional Overture tiles.

## Installation

To load the repository version in Chrome:

1. Download or clone this repository and extract it into a folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Optionally pin **cOSMetics for iD** to the toolbar.

The bundled `dist/overture.js` is included, so no build step is required to install. After updating the files, reload the extension and open iD tabs.

## Usage

### Custom Background Layers

1. Open the extension popup, click **Add new layer**, enter a name and URL template, then **Save settings**.
2. In iD, open **Background settings**, then **Edit custom background** (three dots).
3. Choose a saved background from the extension's panel.

### 🏠 Using the Building Assistant

1. Enable **Show Overture building controls in iD** in the popup.
2. At zoom 18 or higher, click **Load area**. Use **Clear layer** to remove the snapshot; disabling the controls also clears it.
3. Select an outline, press **A** or click **Add (A)**, then check and correct the building before uploading. Each building is added individually; iD's Undo can revert the addition.

### 💡 Using OSMradamus

1. Make your edits in iD and click **Save**.
2. Click **OSMradamus** to generate a comment from your edits and the current area.
3. Review and edit the comment before uploading.

> **Tip:** Press `Ctrl+Shift+L` in iD to open the location panel and help identify the area name.

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

Suggestions, bug reports and pull requests are welcome on the [GitHub repository](https://github.com/dp7x/iD-multilayer). You can also [contact me on OpenStreetMap](https://www.openstreetmap.org/messages/new/dp7).

## License

The extension's code is licensed under the [MIT License](LICENSE). Bundled dependencies retain their own notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Overture building data is separate from the code license. Overture lists its buildings theme under **ODbL 1.0**, with source attributions including Microsoft Global ML Building Footprints, Google Open Buildings and OpenStreetMap contributors. See [Overture's attribution and licensing page](https://docs.overturemaps.org/attribution/). Credits and the licensing link are displayed in the map control; OpenStreetMap-sourced candidates are excluded from this overlay.

## Credits

© 2024–2026 **dp7** [@OpenStreetMap](https://www.openstreetmap.org/user/dp7)

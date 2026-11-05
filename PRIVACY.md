# Privacy Policy — cOSMetics for iD

Last updated: 5 November 2026

cOSMetics for iD is an independent Chrome extension developed by dp7 to assist with the OpenStreetMap iD mapping workflow.

### Data used by the extension

The extension processes map coordinates, relevant iD editor content and locally generated edit data to provide background selection, building assistance, mapping grids and changeset comment suggestions. It reads the active tab URL only when the user requests a mapping grid. It does not record general browsing history or obtain device GPS location.

Edits are analysed in the browser. The developer does not operate a server that receives or stores your edit data, settings or usage statistics. The extension does not include advertising, analytics or a developer-operated tracking system.

### Stored preferences

Custom background names and URL templates, the English-comment preference are stored using Chrome sync storage. Chrome may synchronise these settings according to your browser configuration.

The configured changeset hashtag, the marker used to manage that hashtag, floating-panel positions, geometry simplification tolerance, popup section states and grid parameters are stored using Chrome local storage. These preferences remain until changed, cleared or removed using browser controls. Downloaded GeoJSON files are stored on your computer and remain under your control.

### External services

When an area name is needed for a requested changeset comment, the extension may send the map coordinates to Nominatim at nominatim.openstreetmap.org over HTTPS.

When you enable the Overture controls and click Load area, the extension requests the public catalog at stac.overturemaps.org and building tile data at overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com. Requests identify the data needed for the viewed map area.

Background imagery is requested from the tile providers selected by you through iD. Those providers receive the normal network information and tile requests needed to display their imagery. Use providers and imagery appropriate for OpenStreetMap mapping.

External services may receive network information such as your IP address and requested resource, and handle requests under their own policies. Their retention practices are outside the developer’s control. Saving edits through iD uses OpenStreetMap’s normal account and upload workflow; cOSMetics does not upload changesets automatically or operate a separate account system.

### Purpose and limited use

Data is used only to provide the disclosed OpenStreetMap mapping features. The developer does not sell user data, use it for advertising, use it for unrelated purposes, or use it to determine creditworthiness or for lending. The use of data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

### Your controls and contact

You can edit or remove saved backgrounds, clear the configured hashtag, disable Overture assistance, change stored preferences, delete downloaded files, or remove the extension using Chrome. Chrome sync settings are managed through Chrome. No developer-hosted user database exists for which deletion must be requested.

For questions, contact dp7 through OpenStreetMap: https://www.openstreetmap.org/user/dp7


## Sensei — tag review

Imported Overpass JSON/GeoJSON files are processed locally as lists of OpenStreetMap object IDs. Sensei uses the iD editor to load selected objects and apply user-confirmed tag changes to the local edit history. It does not contact Overpass or upload changesets. Imported lists, rules and review position stay in the editor tab memory until the tab is closed or reloaded. Normal iD data requests and uploads remain subject to OpenStreetMap’s policies.

## Ockham — geometry simplification

Ockham processes the selected way and loaded OSM data inside the browser. Preview is a temporary map overlay; explicit Apply records an edit in iD history. The feature makes no separate external service requests and never uploads a changeset. Metre tolerance is stored in extension local storage. Original OSM request/upload behavior remains managed by iD.

## Floating-panel activation

Bricks, Sensei and Ockham start disabled whenever iD is opened or reloaded. Their activation is held only in the current page memory and is not saved or synchronised between browser sessions or tabs. Tool preferences and panel positions remain stored independently.

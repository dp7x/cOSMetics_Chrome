// content.js

(() => { 
    const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

    let buttonUrls = [];
    let panelInstance = null; 
    let observerFieldTemplate = null; 

    // fixed colors
    const FIXED_BUTTON_COLORS = [
        '#34495e', 
        '#2c3e50', 
        '#22303e', 
        '#4a617c', 
        '#5e7c9b', 
        '#7b9cb9', 
        // Add more colors if you create new layer buttons
    ];

    // CUSTOM BACKGROUND SETUP
    async function loadButtonUrlsFromStorage() {
        const items = await chrome.storage.sync.get('customLayerSettings');
        if (items.customLayerSettings && items.customLayerSettings.length > 0) {
            buttonUrls = items.customLayerSettings.map((layer, index) => ({
                text: layer.text,
                url: layer.url,
                color: FIXED_BUTTON_COLORS[index % FIXED_BUTTON_COLORS.length] // We cycle colors and assign one
            }));
            console.log('Custom layer settings loaded from storage:', buttonUrls);
        } else {
            // No custom backgrounds have been saved yet. The Overture overlay
            // works independently, so this is a normal state on a fresh install.
            buttonUrls = [];
        }
    }

	// Lets look for the text area
    function findFieldTemplateInModal() {
        const settingsModal = document.querySelector('.settings-modal.settings-custom-background');
        if (settingsModal) {
            const fieldTemplate = settingsModal.querySelector('.field-template');
            if (fieldTemplate) {
                console.log('Div .field-template found inside the settings modal!');
                return fieldTemplate;
            }
        }
        return null;
    }

	//panel with layer buttons
    function showFloatingPanel(fieldTemplate) {
        if (panelInstance) {
            console.log('Panel already open, not opening again.');
            return;
        }

        if (buttonUrls.length === 0) {
            alert(t('configureLayers'));
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'osm-custom-layer-panel';
        panel.style.cssText = `
            position: fixed;
            top: 45%; 
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: #f8f8f8; 
            border: 1px solid #ccc; 
            padding: 15px; 
            box-shadow: none; 
            z-index: 1000;
            text-align: center;
            width: fit-content; 
            min-width: 350px; 
            max-width: 90vw; 
            max-height: 90vh;
            overflow-y: auto;
            border-radius: 4px; 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
        `;

        const title = document.createElement('h4');
        title.textContent = t('chooseBackground');
        title.style.cssText = `
            text-align: center;
            font-size: 14px;
            margin-top: 0;
            margin-bottom: 10px;
            color: #333;
        `;
        panel.appendChild(title);

        const closeButton = document.createElement('button');
        closeButton.textContent = 'X';
        closeButton.title = t('close');
        closeButton.style.cssText = `
            position: absolute;
            top: 5px;
            right: 5px;
            border: none;
            background-color: transparent;
            font-size: 16px;
            cursor: pointer;
            color: #666;
            font-weight: bold;
        `;
        closeButton.onclick = () => {
            panel.remove();
            panelInstance = null;
            if (observerFieldTemplate) {
                observerFieldTemplate.disconnect();
                observerFieldTemplate = null;
            }
        };
        panel.appendChild(closeButton);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            flex-direction: row; 
            flex-wrap: nowrap; 
            gap: 8px; 
            justify-content: center; 
        `;
        panel.appendChild(buttonContainer);

        buttonUrls.forEach(buttonData => {
            if (!buttonData.url || !buttonData.text) {
                return;
            }

            const btn = document.createElement('button');
            btn.textContent = buttonData.text;
            btn.style.cssText = `
                background-color: ${buttonData.color || FIXED_BUTTON_COLORS[0]}; 
                color: white;
                border: 1px solid ${darkenColor(buttonData.color || FIXED_BUTTON_COLORS[0], 25)};
                padding: 8px 12px; 
                cursor: pointer;
                border-radius: 3px; 
                font-size: 13px; 
                font-weight: bold;
                transition: background-color 0.2s ease, border-color 0.2s ease;
                white-space: nowrap; 
                width: auto; 
            `;
            btn.onmouseover = () => {
                btn.style.backgroundColor = darkenColor(buttonData.color || FIXED_BUTTON_COLORS[0], 15);
                btn.style.borderColor = darkenColor(buttonData.color || FIXED_BUTTON_COLORS[0], 35);
            };
            btn.onmouseout = () => {
                btn.style.backgroundColor = buttonData.color || FIXED_BUTTON_COLORS[0];
                btn.style.borderColor = darkenColor(buttonData.color || FIXED_BUTTON_COLORS[0], 25);
            };

            btn.onclick = () => {
                fieldTemplate.value = buttonData.url;
                const event = new Event('input', { bubbles: true });
                fieldTemplate.dispatchEvent(event);
                fieldTemplate.focus();
				
				const okButton = document.querySelector('.settings-modal.settings-custom-background .ok-button');
                if (okButton) {
                    console.log('Clicking iD OK button.');
                    okButton.click(); // ID standard OK button
                }
				
                panel.remove();
                panelInstance = null;
                if (observerFieldTemplate) {
                    observerFieldTemplate.disconnect();
                    observerFieldTemplate = null;
                }
            };
            buttonContainer.appendChild(btn);
        });

        document.body.appendChild(panel);
        panelInstance = panel;

        const handleEscapeKey = (e) => {
            if (e.key === 'Escape') {
                panel.remove();
                panelInstance = null;
                document.removeEventListener('keydown', handleEscapeKey);
                if (observerFieldTemplate) {
                    observerFieldTemplate.disconnect();
                    observerFieldTemplate = null;
                }
            }
        };
        document.addEventListener('keydown', handleEscapeKey);
    }

    function darkenColor(hex, percent) {
        let f = parseInt(hex.slice(1), 16),
            t = percent < 0 ? 0 : 255,
            p = percent < 0 ? percent * -1 : percent,
            R = f >> 16,
            G = (f >> 8) & 0x00ff,
            B = f & 0x0000ff;
        return (
            "#" +
            (
                0x1000000 +
                (Math.round((t - R) * p) + R) * 0x10000 +
                (Math.round((t - G) * p) + G) * 0x100 +
                (Math.round((t - B) * p) + B)
            )
            .toString(16)
            .slice(1)
        );
    }

	//Monitors the DOM for the appearance of the final modal with the text area. It is only launched when the .layer-browse button is clicked.
    function observeFieldTemplateModal() {
        if (observerFieldTemplate) {
            observerFieldTemplate.disconnect(); 
        }

        observerFieldTemplate = new MutationObserver((mutationsList, observer) => {
            const fieldTemplate = findFieldTemplateInModal();
            const settingsModal = document.querySelector('.settings-modal.settings-custom-background');

            // checks for modal with the text area
            if (settingsModal && settingsModal.style.opacity === '1' && fieldTemplate && !panelInstance) {
                console.log('Custom Background Settings modal appeared with field-template. Showing custom panel.');
                showFloatingPanel(fieldTemplate);
            } else if (!settingsModal && panelInstance) {
                console.log('Custom Background Settings modal disappeared. Closing custom panel.');
                panelInstance.remove();
                panelInstance = null;
                observer.disconnect();
                observerFieldTemplate = null;
            }
        });

        observerFieldTemplate.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        console.log('Started observing for Custom Background Settings modal.');
    }

	//Main function for configuring listeners for the iD interface. This runs within the iD iframe.
    async function setupIDEditorListeners() {
        await loadButtonUrlsFromStorage();

        // Listener for "Background Settings" button
        document.body.addEventListener('click', (event) => {
            const backgroundButton = event.target.closest('.map-control.map-pane-control.background-control button');
            if (backgroundButton) {
                const useElement = backgroundButton.querySelector('use[xlink\\:href="#iD-icon-layers"]');
                if (useElement) {
                    console.log('Background Settings button clicked (delegated event).');
                }
            }

            const layerBrowseButton = event.target.closest('button.layer-browse');
            if (layerBrowseButton) {
                console.log('.layer-browse button clicked (delegated event).');
                observeFieldTemplateModal();
            }
        });

        console.log('Delegated click listeners set up for iD editor buttons.');
    }

	// ==============================================
	// NEW FEATURE: Changeset comment suggester
    // ==============================================

    let englishMessagesPromise;

    async function commentMessages(english) {
        if (!english) return null;
        englishMessagesPromise ||= fetch(chrome.runtime.getURL('_locales/en/messages.json'))
            .then(response => {
                if (!response.ok) throw new Error('English comment translations unavailable');
                return response.json();
            });
        return englishMessagesPromise;
    }

    function commentText(key, messages, substitution) {
        const message = messages ? messages[key]?.message : chrome.i18n.getMessage(key, substitution);
        return message ? (messages ? message.replaceAll('$1', substitution || '') : message) : key;
    }
    
    // Use a precise label for known key=value pairs, otherwise the key's label.
    function typeLabel(type, messages) {
        const translated = commentText(`tag_${type.replace('=', '_')}`, messages);
        if (translated.startsWith('tag_')) return type.replace(/_/g, ' ');
        if (translated) return translated;
        return type.replace(/_/g, ' ');
    }

    function normalizeCommentHashtag(value) {
        if (typeof value !== 'string') return '';
        const text = value.trim().replace(/^#+/, '');
        if (!text) return '';
        if (!/^[\p{L}\p{M}\p{N}_-]+$/u.test(text) || text.length > 99) return null;
        return `#${text}`;
    }

    // Changeset comment matrix: only these keys classify a known object.
    // Listed values get a specific label; all other values use the master key.
    // Edit this matrix together with tag_<key>_<value> in each locale.
    const MASTER_TAG_RULES = {
        "landuse": {
            "values": [
                "forest",
                "farmland",
                "meadow"
            ]
        },
        "natural": {
            "values": [
                "tree",
                "wood",
                "water",
                "scrub",
                "grassland",
                "wetland",
                "peak",
                "cliff"
            ]
        },
        "building": {
            "values": []
        },
        "highway": {
            "values": [
                "footway",
                "path",
                "cycleway",
                "track"
            ],
            "modified": "key"
        },
        "waterway": {
            "values": [
                "river",
                "stream"
            ]
        },
        "leisure": {
            "values": [
                "park",
                "playground",
                "pitch",
                "garden"
            ]
        },
        "amenity": {
            "values": [
                "parking",
                "school",
                "restaurant",
                "drinking_water",
                "place_of_worship"
            ]
        },
        "historic": {
            "values": [
                "memorial",
                "archaeological_site",
                "ruins",
                "castle",
                "monument"
            ]
        },
        "shop": {
            "values": []
        },
        "office": {
            "values": []
        },
        "tourism": {
            "values": [
                "viewpoint",
                "information",
                "camp_site",
                "hotel",
                "attraction"
            ]
        },
        "man_made": {
            "values": [
                "tower",
                "bridge"
            ]
        },
        "barrier": {
            "values": []
        },
        "railway": {
            "values": [
                "rail",
                "station"
            ]
        },
        "route": {
            "values": [
                "hiking",
                "bicycle"
            ]
        },
        "place": {
            "values": [
                "village",
                "locality"
            ]
        },
        "public_transport": {
            "values": []
        },
        "power": {
            "values": []
        },
        "type": {
            "values": []
        }
    };
    const PRIMARY_TAGS = new Set(Object.keys(MASTER_TAG_RULES));

    function recognizedType(key, value, action) {
        const rule = MASTER_TAG_RULES[key];
        if (rule?.modified === 'key' && action === 'modify') return key;
        return rule?.values.includes(value) ? `${key}=${value}` : key;
    }

    // Used only to screen a single unknown candidate when no known master tag exists.
    const SECONDARY_TAGS = new Set([
        'type', 'name', 'alt_name', 'official_name', 'short_name', 'loc_name',
        'source', 'note', 'fixme', 'description', 'website', 'url', 'phone', 'email',
        'wikidata', 'wikipedia', 'ref', 'operator', 'brand', 'opening_hours',
        'start_date', 'check_date', 'created_by', 'attribution', 'import',
        'height', 'ele', 'layer', 'level', 'surface', 'smoothness', 'width',
        'lanes', 'maxspeed', 'oneway', 'access', 'foot', 'bicycle',
        'motor_vehicle', 'lit', 'fee', 'service', 'tracktype',
        'leaf_type', 'leaf_cycle', 'species', 'genus', 'taxon',
        'denotation', 'circumference'
    ]);
    const SECONDARY_PREFIXES = [
        'name:', 'addr:', 'contact:', 'source:', 'ref:', 'payment:',
        'roof:', 'building:', 'note:', 'fixme:', 'description:',
        'operator:', 'brand:', 'survey:'
    ];

    function describesObject(key, value) {
        return typeof key === 'string' && key.length > 0 &&
            (PRIMARY_TAGS.has(key) || !SECONDARY_TAGS.has(key)) &&
            !SECONDARY_PREFIXES.some(prefix => key.startsWith(prefix)) &&
            !(key === 'building' && value === 'no');
    }

    function typeTags(tags) {
        const candidates = tags.filter(([key, value]) => describesObject(key, value));
        let primary = candidates.filter(([key]) => PRIMARY_TAGS.has(key));
        // A relation's type is a fallback when no descriptive master is present.
        if (primary.some(([key]) => key !== 'type')) primary = primary.filter(([key]) => key !== 'type');
        if (primary.length) return primary;
        // A future master key (e.g. AI=chatgpt) can be shown by its key if
        // unambiguous. Multiple unknown keys cannot safely be classified.
        return candidates.length === 1 ? candidates : [];
    }

    function parentWaysForModifiedNodes(ids) {
        let parents = [];
        const receive = event => { parents = event.detail?.parents || []; };
        document.addEventListener('cosmetics:modified-node-parents-result', receive, { once: true });
        document.dispatchEvent(new CustomEvent('cosmetics:modified-node-parents', { detail: { ids } }));
        document.removeEventListener('cosmetics:modified-node-parents-result', receive);
        return parents;
    }

    function loadedGeometryPoints(ids) {
        let points = {};
        const receive = event => { points = event.detail?.points || {}; };
        document.addEventListener('cosmetics:geometry-points-result', receive, { once: true });
        document.dispatchEvent(new CustomEvent('cosmetics:geometry-points', { detail: { ids } }));
        document.removeEventListener('cosmetics:geometry-points-result', receive);
        return points;
    }

	// Download and parse OSMChange file to extract object types
	async function analyzeChangesFromOsmChange() {
		// Find the link to download the OSMChange file
		const downloadLink = document.querySelector('.download-changes');
		if (!downloadLink) {
			console.log("cOSMetics for iD: Link OSMChange not found");
			return null;
		}
		
		const osmChangeUrl = downloadLink.href;
		if (!osmChangeUrl || !osmChangeUrl.startsWith('blob:')) {
			console.log("cOSMetics for iD: URL OSMChange invalid");
			return null;
		}
		
		try {
			const response = await fetch(osmChangeUrl);
			const osmChangeText = await response.text();
			
			// Parsing XML
			const parser = new DOMParser();
			const xmlDoc = parser.parseFromString(osmChangeText, 'text/xml');
			
			const created = Object.create(null);
			const modified = Object.create(null);
            const createdPoints = Object.create(null);
            const modifiedPoints = Object.create(null);
			const changedUntaggedNodeIds = [];
			const modifiedWayIds = new Set();
			
			function recordTag(key, value, action, pointCount = 1) {
				if (!describesObject(key, value)) return;
				const type = recognizedType(key, value, action);
				const counts = action === 'create' ? created : modified;
				counts[type] = (counts[type] || 0) + 1;
                const points = action === 'create' ? createdPoints : modifiedPoints;
                points[type] = (points[type] || 0) + pointCount;
			}

            // Count unique geometry nodes; closed ways count the closing node once.
            const entities = new Map();
            const prefix = { node: 'n', way: 'w', relation: 'r' };
            for (const kind of Object.keys(prefix)) {
                for (const entity of xmlDoc.getElementsByTagName(kind)) {
                    entities.set(prefix[kind] + entity.getAttribute('id'), entity);
                }
            }
            const relations = [...entities.keys()].filter(id => id.startsWith('r'));
            const loadedPoints = relations.length ? loadedGeometryPoints(relations) : {};
            function localNodeIds(entity, visited = new Set(), nodes = new Set()) {
                const id = prefix[entity.tagName] + entity.getAttribute('id');
                if (visited.has(id)) return nodes;
                visited.add(id);
                if (entity.tagName === 'node') nodes.add(entity.getAttribute('id'));
                if (entity.tagName === 'way') {
                    for (const nd of entity.getElementsByTagName('nd')) nodes.add(nd.getAttribute('ref'));
                }
                if (entity.tagName === 'relation') {
                    for (const member of entity.getElementsByTagName('member')) {
                        const kind = member.getAttribute('type');
                        const ref = member.getAttribute('ref');
                        if (kind === 'node') nodes.add(ref);
                        const child = entities.get(prefix[kind] + ref);
                        if (child) localNodeIds(child, visited, nodes);
                    }
                }
                return nodes;
            }
            function geometryPoints(entity) {
                const id = prefix[entity.tagName] + entity.getAttribute('id');
                return Math.max(1, localNodeIds(entity).size, Number(loadedPoints[id]) || 0);
            }

			// Helper function to process tags from an element
			function processTags(element, action) {
				const tags = [...element.getElementsByTagName('tag')]
					.map(tag => [tag.getAttribute('k'), tag.getAttribute('v')]);
				for (const [key, value] of typeTags(tags)) {
					recordTag(key, value, action, geometryPoints(element));
				}
			}
			
			// An independent node can also carry a future, not yet translated key.
			function hasClassifyingTags(node) {
				const tags = [...node.getElementsByTagName('tag')]
					.map(tag => [tag.getAttribute('k'), tag.getAttribute('v')]);
				return typeTags(tags).length > 0;
			}
			
			// Analyze <create> and <modify> sections
			const actions = ['create', 'modify'];
			actions.forEach(action => {
				const elements = xmlDoc.getElementsByTagName(action);
				for (const element of elements) {
					// Process ways
					const ways = element.getElementsByTagName('way');
					for (const way of ways) {
						if (action === 'modify') modifiedWayIds.add(`w${way.getAttribute('id')}`);
						processTags(way, action);
					}
					
					// Process relations
					const relations = element.getElementsByTagName('relation');
					for (const relation of relations) {
						processTags(relation, action);
					}
					
					// Process INDEPENDENT nodes only (nodes with their own tags)
					const nodes = element.getElementsByTagName('node');
					for (const node of nodes) {
						// Only count nodes with descriptive tags themselves
						// (skip nodes that are just geometry for ways/relations)
						if (hasClassifyingTags(node)) {
							processTags(node, action);
						} else if (action === 'modify' && node.getElementsByTagName('tag').length === 0) {
							changedUntaggedNodeIds.push(node.getAttribute('id'));
						}
					}
				}
			});

			// A moved node may belong to a way absent from OSMChange's modify block.
			// Classify loaded parent ways once each, then fall back to geometry.
			if (changedUntaggedNodeIds.length) {
				for (const parent of parentWaysForModifiedNodes(changedUntaggedNodeIds)) {
					if (modifiedWayIds.has(parent.id)) continue;
					for (const [key, value] of typeTags(Object.entries(parent.tags || {}))) {
						recordTag(key, value, 'modify', Math.max(1, Number(parent.pointCount) || 0));
					}
				}
				if (Object.keys(modified).length === 0) {
                    modified.geometry = 1;
                    modifiedPoints.geometry = new Set(changedUntaggedNodeIds).size;
                }
			}
			
			const totalTypes = Object.keys(created).length + Object.keys(modified).length;
			
			if (totalTypes === 0) {
				console.log("cOSMetics for iD: No descriptive tags found in OSMChange");
				return null;
			}
			
			console.log("cOSMetics for iD: Created types:", created);
			console.log("cOSMetics for iD: Modified types:", modified);
			
			return { created, modified, createdPoints, modifiedPoints };
			
		} catch (error) {
			console.error("cOSMetics for iD: Error in parsing OSMChange:", error);
			return null;
		}
	}
     
// Gets geographic area from coordinates
async function getCurrentArea() {
    try {
        // 1. Try to get area from location panel (Ctrl+Shift+L)
        const locationControl = document.querySelector('.location-control .location-status, .map-control.map-pane-control.location-control');
        if (locationControl) {
            const locationText = locationControl.textContent || locationControl.innerText;
            const lines = locationText.split('\n').filter(l => l.trim());
            
            for (const line of lines) {
                if (line.includes(',') && !line.includes('°') && !line.includes('′')) {
                    const parts = line.split(',');
                    if (parts.length > 0) {
                        const city = parts[0].trim();
                        if (city && city !== '') {
                            console.log(`cOSMetics for iD: Area from location panel: ${city}`);
                            return city;
                        }
                    }
                }
            }
            
            for (const line of lines) {
                const coordMatch = line.match(/(\d+\.\d+),\s*(\d+\.\d+)/);
                if (coordMatch) {
                    const lat = parseFloat(coordMatch[1]);
                    const lon = parseFloat(coordMatch[2]);
                    const area = await getAreaFromNominatim(lat, lon);
                    if (area) return area;
                    break;
                }
            }
        }
        
        // 2. Try to get coordinates from parent URL (the one in the address bar)
        try {
            const parentUrl = window.parent.location.href || document.referrer || window.location.href;
            const match = parentUrl.match(/#map=\d+\/([\d.]+)\/([\d.]+)/);
            if (match) {
                const lat = parseFloat(match[1]);
                const lon = parseFloat(match[2]);
                console.log(`cOSMetics for iD: Coordinates from URL: ${lat}, ${lon}`);
                const area = await getAreaFromNominatim(lat, lon);
                if (area) {
                    console.log(`cOSMetics for iD: Area from URL: ${area}`);
                    return area;
                }
            }
        } catch (e) {
            console.log("cOSMetics for iD: Cannot access parent URL:", e);
        }
        
        // 3. Try to get coordinates from OSMChange file nodes
        const downloadLink = document.querySelector('.download-changes');
        if (downloadLink) {
            const osmChangeUrl = downloadLink.href;
            if (osmChangeUrl && osmChangeUrl.startsWith('blob:')) {
                const response = await fetch(osmChangeUrl);
                const osmChangeText = await response.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(osmChangeText, 'text/xml');
                
                let lats = [], lons = [];
                const nodes = xmlDoc.getElementsByTagName('node');
                for (const node of nodes) {
                    const lat = parseFloat(node.getAttribute('lat'));
                    const lon = parseFloat(node.getAttribute('lon'));
                    if (!isNaN(lat) && !isNaN(lon)) {
                        lats.push(lat);
                        lons.push(lon);
                    }
                }
                
                if (lats.length > 0) {
                    const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
                    const centerLon = lons.reduce((a, b) => a + b, 0) / lons.length;
                    const area = await getAreaFromNominatim(centerLat, centerLon);
                    if (area) return area;
                }
            }
        }
        
    } catch (error) {
        console.error("cOSMetics for iD: Error getting the area:", error);
    }
    
    return t('unknownArea');
}

// Helper function to get area from Nominatim
async function getAreaFromNominatim(lat, lon) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&zoom=10&format=json&addressdetails=1`,
            {
                headers: {
                    'User-Agent': 'cOSMetics for iD-extension/1.0 (https://github.com/dp7x/iD-multilayer)'
                }
            }
        );
        const data = await response.json();
        const area = data.address?.city || 
                    data.address?.town || 
                    data.address?.village || 
                    data.address?.county;
        return area || null;
    } catch (e) {
        console.log("cOSMetics for iD: Nominatim error:", e);
        return null;
    }
}
    
    // Generate a sentence in the UI language, or in English when requested.
    async function generateComment(typeCount, areaName, english = false) {
        const messages = await commentMessages(english);
        const created = typeCount.created || {};
        const modified = typeCount.modified || {};
        
        const MAX_COMMENT_TYPES = 4;
        // Frequency first, total unique geometry points second. Stable ties preserve encounter order.
        const sortTypes = (counts, points) => Object.entries(counts).sort((a, b) =>
            b[1] - a[1] || (points[b[0]] || 0) - (points[a[0]] || 0));
        const sortedCreated = sortTypes(created, typeCount.createdPoints || {});
        const sortedModified = sortTypes(modified, typeCount.modifiedPoints || {});
        const displayedCreated = sortedCreated.slice(0, MAX_COMMENT_TYPES);
        const displayedModified = sortedModified.slice(0, MAX_COMMENT_TYPES);
        const parts = [];
        const hasOtherImprovements = sortedCreated.length > displayedCreated.length ||
            sortedModified.length > displayedModified.length;

        const feminineTypes = new Set([
            'geometry', 'railway', 'place', 'public_transport', 'power',
            'natural=grassland', 'natural=wetland', 'natural=peak', 'natural=cliff',
            'leisure=playground', 'historic=ruins', 'landuse=forest',
            'tourism=attraction', 'type'
        ]);
        const language = english ? 'en' : chrome.i18n.getUILanguage().split(/[-_]/)[0].toLowerCase();
        const italian = language === 'it';
        const verb = (action, type) => {
            const feminine = italian && feminineTypes.has(type);
            const key = `${action}Prefix${feminine ? 'Feminine' : ''}`;
            const word = commentText(key, messages);
            return parts.length ? word.toLowerCase() : word;
        };
        
        const phrase = (action, entries, labels) => {
            const list = labels.join(', ');
            if (language === 'de') {
                const word = commentText(`${action}Prefix`, messages).toLowerCase();
                const text = `${list} ${word}`;
                return parts.length ? text : text.charAt(0).toUpperCase() + text.slice(1);
            }
            let prefix = verb(action, entries[0][0]);
            if (language === 'fr' && /^[aeiouyàâäéèêëîïôöùûühœæ]/i.test(list)) {
                return `${prefix.replace(/de$/, 'd’')}${list}`;
            }
            return `${prefix} ${list}`;
        };

        // Build "created" part
        const createdTypes = displayedCreated.map(([key]) => typeLabel(key, messages));
        if (createdTypes.length > 0) {
            parts.push(phrase('created', displayedCreated, createdTypes));
        }
        
        // Build "modified" part
        const modifiedTypes = displayedModified.map(([key]) => typeLabel(key, messages));
        if (modifiedTypes.length > 0) {
            parts.push(phrase('modified', displayedModified, modifiedTypes));
        }
        
        // If nothing found, return null
        if (parts.length === 0) return null;
        
        // Join the parts
        let comment = parts.join(' + ');
        
        // Mention other improvements only when categories have been omitted.
        if (hasOtherImprovements) {
            comment += ` + ${commentText('otherImprovements', messages)}`;
        }
        
        comment += ` ${commentText('commentArea', messages, areaName)}`;
        return comment;
    }
    
   // Updated version of insertSuggestedComment
    async function insertSuggestedComment() {
        //console.log("cOSMetics for iD: Generating suggested comment...");
        
        // Show loading indicator
        const suggestBtn = document.getElementById('id-multilayer-suggest-btn');
        const originalText = suggestBtn ? suggestBtn.textContent : '';
        if (suggestBtn) {
            suggestBtn.textContent = `⏳ ${t('analyzing')}`;
            suggestBtn.disabled = true;
        }
        
        try {
            const typeCount = await analyzeChangesFromOsmChange();
            
            if (!typeCount) {
                alert(t('noChanges'));
                return;
            }
            
            const areaName = await getCurrentArea();
            const { commentsInEnglish = false } = await chrome.storage.sync.get('commentsInEnglish');
            const suggestion = await generateComment(typeCount, areaName, commentsInEnglish);
            
            if (suggestion) {
                const commentField = document.querySelector('.form-field-comment textarea');
                if (commentField) {
                    commentField.value = suggestion;
                    commentField.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    commentField.style.backgroundColor = '#e8f5e9';
                    commentField.style.transition = 'background-color 0.5s ease';
                    setTimeout(() => {
                        commentField.style.backgroundColor = '';
                    }, 1000);
                    
                    //console.log(`cOSMetics for iD: Comment inserted: "${suggestion}"`);
                } else {
                    alert(t('commentFieldMissing'));
                }
            }
        } catch (error) {
            console.error('cOSMetics: comment suggestion failed', error);
            alert(t('commentError'));
        } finally {
            // Restore button
            if (suggestBtn) {
                suggestBtn.textContent = originalText;
                suggestBtn.disabled = false;
            }
        }
    }
    
    // Apply once per upload panel, so removing a hashtag manually in iD is respected.
    const hashtagPanels = new WeakSet();
    const pendingHashtagPanels = new WeakSet();
    const queuedHashtagPanels = new WeakSet();
    const panelHashtags = new WeakMap();
    async function prefillChangesetHashtag(panel, force = false) {
        if (pendingHashtagPanels.has(panel)) {
            if (force) queuedHashtagPanels.add(panel);
            return;
        }
        if (!force && hashtagPanels.has(panel)) return;
        pendingHashtagPanels.add(panel);
        try {
            const values = await chrome.storage.local.get(['changesetHashtag', 'appliedChangesetHashtag']);
            if (!panel.isConnected) return;
            const hashtag = normalizeCommentHashtag(values.changesetHashtag) || '';
            const previous = normalizeCommentHashtag(panelHashtags.has(panel) ?
                panelHashtags.get(panel) : values.appliedChangesetHashtag) || '';
            if (!hashtag && !previous) { hashtagPanels.add(panel); return; }
            let ok = false;
            const receive = event => { ok = event.detail?.ok === true; };
            document.addEventListener('cosmetics:changeset-hashtag-result', receive, { once: true });
            document.dispatchEvent(new CustomEvent('cosmetics:changeset-hashtag', { detail: { hashtag, previous } }));
            document.removeEventListener('cosmetics:changeset-hashtag-result', receive);
            if (ok) {
                hashtagPanels.add(panel);
                panelHashtags.set(panel, hashtag);
                await chrome.storage.local.set({ appliedChangesetHashtag: hashtag });
            }
        } catch (error) {
            console.warn('cOSMetics: hashtag prefill failed', error);
        } finally {
            pendingHashtagPanels.delete(panel);
            if (queuedHashtagPanels.has(panel)) {
                queuedHashtagPanels.delete(panel);
                prefillChangesetHashtag(panel, true);
            }
        }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.changesetHashtag) return;
        const panel = document.querySelector('.modal-section.changeset-editor');
        if (panel) prefillChangesetHashtag(panel, true);
    });

    // Add "Suggest comment" button to the save dialog
    let saveDialogObserver = null;
    
    function addSuggestionButtonToSaveDialog() {
        // Prevent duplicate observers
        if (saveDialogObserver) return;
        
        saveDialogObserver = new MutationObserver(() => {
            // Look for the changeset panel (when the save dialog appears)
            const changesetEditor = document.querySelector('.modal-section.changeset-editor');
            const existingButton = document.getElementById('id-multilayer-suggest-btn');
            if (changesetEditor) prefillChangesetHashtag(changesetEditor);
            
            // If we find the changeset editor and the button doesn't exist yet
            if (changesetEditor && !existingButton) {
                // Look for the button container (where Cancel and Save are)
                const buttonContainer = document.querySelector('.save-section .buttons');
                
                if (buttonContainer) {
                    const suggestBtn = document.createElement('button');
                    suggestBtn.id = 'id-multilayer-suggest-btn';
                    suggestBtn.textContent = `💡 ${t('suggest')}`;
                    suggestBtn.className = 'action button';  // Uses ID class for style
                    suggestBtn.style.marginRight = '8px';
                    suggestBtn.style.backgroundColor = '#4CAF50';
                    suggestBtn.style.color = 'white';
                    suggestBtn.style.border = 'none';
                    suggestBtn.style.borderRadius = '3px';
                    suggestBtn.style.padding = '6px 12px';
                    suggestBtn.style.cursor = 'pointer';
                    suggestBtn.style.fontSize = '13px';
                    suggestBtn.style.fontWeight = 'bold';
                    
                    // Hover effect
                    suggestBtn.onmouseover = () => { suggestBtn.style.backgroundColor = '#45a049'; };
                    suggestBtn.onmouseout = () => { suggestBtn.style.backgroundColor = '#4CAF50'; };
                    
                    suggestBtn.onclick = insertSuggestedComment;
                    
                    // Insert it as the first button (before "Cancel")
                    if (buttonContainer.firstChild) {
                        buttonContainer.insertBefore(suggestBtn, buttonContainer.firstChild);
                    } else {
                        buttonContainer.appendChild(suggestBtn);
                    }
                    
                    //console.log("cOSMetics for iD: 'Suggest comment' button added to save dialog");
                }
            }
        });
        
        // Observe the entire document for the save panel addition
        saveDialogObserver.observe(document.body, { childList: true, subtree: true });
        //console.log("cOSMetics for iD: Save dialog observer activated");
    }
    
    // ==============================================
	// EXTENSION of setupIDEditorListeners function
    // ==============================================
    
    // Save original function
    const originalSetupID = setupIDEditorListeners;
    
    // Redefine it including the new functionality
    window.setupIDEditorListeners = async function() {
        //console.log("cOSMetics for iD: Starting extended setupIDEditorListeners");
        
        await originalSetupID();
        
        // Add comment suggester
        addSuggestionButtonToSaveDialog();
        //console.log("cOSMetics for iD: Comment Suggester ready");
    };
    
    // Start everything
    console.log("cOSMetics for iD: Extension initialization...");
    window.setupIDEditorListeners();

})();


// Relay the popup request to the frame that actually hosts the iD editor.
(() => {
    const frameKey = crypto.randomUUID();
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id !== chrome.runtime.id || message?.kind !== 'cosmetics-grid' ||
            !['probe', 'show'].includes(message.action) ||
            (message.action === 'show' && message.frameKey !== frameKey)) return;
        let result;
        function receive(event) {
            try { result = JSON.parse(event.detail); } catch { /* Invalid response. */ }
        }
        document.addEventListener('cosmetics:grid-result', receive);
        try {
            document.dispatchEvent(new CustomEvent('cosmetics:grid-request', {
                detail: JSON.stringify(message)
            }));
        } finally {
            document.removeEventListener('cosmetics:grid-result', receive);
        }
        if (result) respond({ ...result, frameKey });
    });
})();

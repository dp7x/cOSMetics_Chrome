// Independent utilities: section state and grid generation do not modify iD data.
const featureSections = [...document.querySelectorAll('.feature-section')];
const touchedSections = new Set();
featureSections.forEach(section => {
    section.addEventListener('click', event => {
        if (event.target.closest('summary')) touchedSections.add(section.id);
    });
    section.addEventListener('keydown', event => {
        if (event.target.tagName === 'SUMMARY') touchedSections.add(section.id);
    });
});
chrome.storage.local.get('popupSections', items => {
    featureSections.forEach(section => {
        if (!touchedSections.has(section.id)) section.open = items.popupSections?.[section.id] === true;
        section.addEventListener('toggle', () => {
            const popupSections = Object.fromEntries(featureSections.map(item => [item.id, item.open]));
            chrome.storage.local.set({ popupSections });
        });
    });
});

function readGridCenter(tabUrl) {
    const url = new URL(tabUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'www.openstreetmap.org') throw new Error('gridSite');
    const map = new URLSearchParams(url.hash.slice(1)).get('map');
    const parts = map?.split('/');
    if (!parts || parts.length !== 3 || parts.some(part => part.trim() === '')) throw new Error('gridCoordinates');
    const [zoom, lat, lon] = parts.map(Number);
    if (![zoom, lat, lon].every(Number.isFinite) || Math.abs(lat) >= 85 || Math.abs(lon) > 180) throw new Error('gridCoordinates');
    return { lat, lon };
}

function generateGeoJSONGrid(lon, lat, count, meters) {
    if (!Number.isInteger(count) || count < 1 || count > 10 || !Number.isFinite(meters) || meters < 100 || meters > 1000) throw new Error('gridInvalid');
    const stepLat = meters / 111320;
    const stepLon = meters / ((40075000 * Math.cos(lat * Math.PI / 180)) / 360);
    const top = lat + count * stepLat / 2;
    const left = lon - count * stepLon / 2;
    if (!Number.isFinite(top + left) || top > 90 || top - count * stepLat < -90 || left < -180 || left + count * stepLon > 180) throw new Error('gridCoordinates');
    const features = [];
    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            const west = left + col * stepLon, east = left + (col + 1) * stepLon;
            const north = top - row * stepLat, south = top - (row + 1) * stepLat;
            features.push({ type: 'Feature', properties: { id: `square-${row}-${col}`, grid_index: `${row},${col}` },
                geometry: { type: 'Polygon', coordinates: [[[west,north],[west,south],[east,south],[east,north],[west,north]]] } });
        }
    }
    return { type: 'FeatureCollection', features };
}

const gridSizeInput = document.getElementById('gridSize');
const squareSizeInput = document.getElementById('squareSize');
const gridFeedback = document.getElementById('gridFeedback');
let gridTouched = false;
chrome.storage.local.get('gridParameters', items => {
    if (gridTouched) return;
    const saved = items.gridParameters;
    if (saved && Number.isInteger(saved.count) && saved.count >= 1 && saved.count <= 10 &&
        Number.isFinite(saved.meters) && saved.meters >= 100 && saved.meters <= 1000) {
        gridSizeInput.value = saved.count;
        squareSizeInput.value = saved.meters;
    }
});
function saveGridParameters() {
    gridTouched = true;
    const count = Number(gridSizeInput.value), meters = Number(squareSizeInput.value);
    if (Number.isInteger(count) && count >= 1 && count <= 10 && Number.isFinite(meters) && meters >= 100 && meters <= 1000) {
        chrome.storage.local.set({ gridParameters: { count, meters } });
    }
}
[gridSizeInput, squareSizeInput].forEach(input => input.addEventListener('input', saveGridParameters));
const gridOffer = document.getElementById('gridOffer');
const gridShow = document.getElementById('gridShow');
const gridReplaceNotice = document.getElementById('gridReplaceNotice');
const gridDownload = document.getElementById('generateGrid');
let pendingGrid;
function dismissGridOffer() {
    pendingGrid = undefined;
    gridOffer.hidden = true;
}
document.getElementById('gridDismiss').addEventListener('click', dismissGridOffer);
async function showPendingGrid() {
    const choice = pendingGrid;
    if (!choice) return;
    gridShow.disabled = gridDownload.disabled = true;
    try {
        const result = await chrome.tabs.sendMessage(choice.tabId, {
            kind: 'cosmetics-grid', action: 'show', frameKey: choice.frameKey,
            data: choice.data, replace: choice.occupied
        });
        if (result?.status === 'occupied') {
            choice.occupied = true;
            gridReplaceNotice.hidden = false;
            return;
        }
        dismissGridOffer();
        gridFeedback.textContent = t(result?.status === 'shown' ? 'gridShown' : 'gridShowUnavailable');
    } catch {
        dismissGridOffer();
        gridFeedback.textContent = t('gridShowUnavailable');
    } finally {
        gridShow.disabled = gridDownload.disabled = false;
    }
}
gridShow.addEventListener('click',showPendingGrid);
gridDownload.addEventListener('click', async () => {
    dismissGridOffer();
    gridDownload.disabled = true;
    try {
        const count = Number(gridSizeInput.value), meters = Number(squareSizeInput.value);
        if (!gridSizeInput.checkValidity() || !squareSizeInput.checkValidity() || !gridSizeInput.value || !squareSizeInput.value) throw new Error('gridInvalid');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) throw new Error('gridSite');
        const { lat, lon } = readGridCenter(tab.url);
        const data = generateGeoJSONGrid(lon, lat, count, meters);
        saveGridParameters();
        const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }));
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `osm_grid_${lat.toFixed(6)}_${lon.toFixed(6)}_${count}x${count}_${meters}m.geojson`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        gridFeedback.textContent = t('gridDone');
        if (/^\/(edit|id)\/?$/.test(new URL(tab.url).pathname)) {
            try {
                const status = await chrome.tabs.sendMessage(tab.id, { kind: 'cosmetics-grid', action: 'probe' });
                if (status?.status === 'ready' && status.frameKey) {
                    pendingGrid = { tabId: tab.id, data, ...status };
                    gridReplaceNotice.hidden = !status.occupied;
                    if(status.occupied) {
                        gridOffer.hidden = false;
                    } else {
                        await showPendingGrid();
                        // Another custom layer may have appeared since the probe.
                        if(pendingGrid?.occupied)gridOffer.hidden=false;
                    }
                }
            } catch { /* The download also works without iD. */ }
        }
    } catch (error) {
        gridFeedback.textContent = t(['gridInvalid', 'gridSite', 'gridCoordinates'].includes(error.message) ? error.message : 'gridError');
    } finally {
        gridDownload.disabled = false;
    }
});

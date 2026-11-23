// A GPX grid is anchored at the first point, with one square centered on it.
function readGpxSegments(text) {
    const root = new DOMParser().parseFromString(text, 'application/xml').documentElement;
    if (root.localName !== 'gpx' ||
        root.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length) {
        throw new Error('gridGpxInvalid');
    }

    const children = (element, name) => Array.from(element.children).filter(child =>
        child.namespaceURI === root.namespaceURI && (!name || child.localName === name)
    );
    const readPoints = (element, name) => children(element, name).map(point => {
        const lon = point.getAttribute('lon')?.trim();
        const lat = point.getAttribute('lat')?.trim();
        const coordinate = [Number(lon), Number(lat)];
        if (!lon || !lat || !coordinate.every(Number.isFinite) ||
            Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90) {
            throw new Error('gridGpxInvalid');
        }
        return coordinate;
    });

    const segments = children(root).flatMap(element => {
        if (element.localName === 'trk') {
            return children(element, 'trkseg').map(segment => readPoints(segment, 'trkpt'));
        }
        return element.localName === 'rte' ? [readPoints(element, 'rtept')] : [];
    }).filter(segment => segment.length);
    if (!segments.some(segment => segment.length >= 2)) throw new Error('gridGpxInvalid');
    return segments;
}

function makeGpxGridProjection([lon, lat]) {
    // Project WGS84 onto the local east/north tangent plane in metres.
    // The inverse intersects a line parallel to the local vertical with WGS84.
    const a = 6378137;
    const b = 6356752.314245179;
    const eccentricitySquared = 1 - (b / a) ** 2;
    const radians = Math.PI / 180;
    const longitude = lon * radians;
    const latitude = lat * radians;
    const sinLon = Math.sin(longitude), cosLon = Math.cos(longitude);
    const sinLat = Math.sin(latitude), cosLat = Math.cos(latitude);
    const east = [-sinLon, cosLon, 0];
    const north = [-sinLat * cosLon, -sinLat * sinLon, cosLat];
    const up = [cosLat * cosLon, cosLat * sinLon, sinLat];
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const scaleToUnitSphere = ([x, y, z]) => [x / a, y / a, z / b];

    function geocentric(longitude, latitude) {
        const sin = Math.sin(latitude), cos = Math.cos(latitude);
        const radius = a / Math.sqrt(1 - eccentricitySquared * sin ** 2);
        return [
            radius * cos * Math.cos(longitude),
            radius * cos * Math.sin(longitude),
            radius * (1 - eccentricitySquared) * sin
        ];
    }

    const origin = geocentric(longitude, latitude);
    const scaledUp = scaleToUnitSphere(up);
    const quadratic = dot(scaledUp, scaledUp);
    return {
        project([pointLon, pointLat]) {
            const point = geocentric(pointLon * radians, pointLat * radians);
            // The projection is one-to-one on the visible side of the ellipsoid.
            const normal = [point[0] / a ** 2, point[1] / a ** 2, point[2] / b ** 2];
            if (dot(normal, up) <= 0) throw new Error('gridCoordinates');
            const delta = point.map((value, i) => value - origin[i]);
            return [dot(delta, east), dot(delta, north)];
        },
        unproject(x, y) {
            const base = origin.map((value, i) => value + x * east[i] + y * north[i]);
            const scaledBase = scaleToUnitSphere(base);
            const linear = dot(scaledBase, scaledUp);
            const constant = dot(scaledBase, scaledBase) - 1;
            const discriminant = linear ** 2 - quadratic * constant;
            if (discriminant <= 0) throw new Error('gridCoordinates');
            const offset = -constant / (linear + Math.sqrt(discriminant));
            const [px, py, pz] = base.map((value, i) => value + offset * up[i]);
            return [
                Math.atan2(py, px) / radians,
                Math.atan2(pz, Math.hypot(px, py) * (1 - eccentricitySquared)) / radians
            ];
        }
    };
}

function generateGpxGrid(segments, meters, includeTrack) {
    if (!Number.isFinite(meters) || meters < 100 || meters > 1000) throw new Error('gridInvalid');
    const projection = makeGpxGridProjection(segments[0][0]);
    const cells = new Map();

    // Normalize to unit squares with integer boundaries. At a boundary keep
    // both adjacent cells, including all four when the trace hits a corner.
    function visit(x, y) {
        function indices(value) {
            const nearest = Math.round(value);
            return Math.abs(value - nearest) < 1e-9 ? [nearest - 1, nearest] : [Math.floor(value)];
        }
        for (const col of indices(x)) {
            for (const row of indices(y)) {
                const key = col + ',' + row;
                if (!cells.has(key)) cells.set(key, [col, row]);
            }
        }
    }

    function visitSegment([x, y], [endX, endY]) {
        const dx = endX - x, dy = endY - y;
        const crossings = [0, 1];
        for (const [start, end, delta] of [[x, endX, dx], [y, endY, dy]]) {
            for (let boundary = Math.floor(Math.min(start, end)) + 1; boundary < Math.max(start, end); boundary++) {
                crossings.push((boundary - start) / delta);
            }
        }
        crossings.sort((a, b) => a - b);
        for (let i = 0; i < crossings.length; i++) {
            const time = crossings[i];
            visit(x + time * dx, y + time * dy);
            if (i + 1 < crossings.length) {
                const middle = (time + crossings[i + 1]) / 2;
                visit(x + middle * dx, y + middle * dy);
            }
        }
    }

    for (const segment of segments) {
        let previous;
        for (const coordinate of segment) {
            const point = projection.project(coordinate).map(value => value / meters + 0.5);
            if (previous) visitSegment(previous, point);
            else visit(...point);
            previous = point;
        }
    }

    const features = Array.from(cells.values(), ([col, row], index) => {
        const left = (col - 0.5) * meters, right = (col + 0.5) * meters;
        const bottom = (row - 0.5) * meters, top = (row + 0.5) * meters;
        const ring = [[left, bottom], [right, bottom], [right, top], [left, top]]
            .map(([x, y]) => projection.unproject(x, y));
        ring.push(ring[0]);
        if (ring.some(([lon], i) => i && Math.abs(lon - ring[i - 1][0]) > 180)) {
            throw new Error('gridCoordinates');
        }
        return {
            type: 'Feature',
            properties: { name: String(index + 1).padStart(3, '0'), grid_index: row + ',' + col },
            geometry: { type: 'Polygon', coordinates: [ring] }
        };
    });
    if (includeTrack) {
        const lines = segments.filter(segment => segment.length >= 2);
        const geometry = lines.length === 1
            ? { type: 'LineString', coordinates: lines[0] }
            : { type: 'MultiLineString', coordinates: lines };
        features.push({ type: 'Feature', properties: {}, geometry });
    }
    return { type: 'FeatureCollection', features };
}

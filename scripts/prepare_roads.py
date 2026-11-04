#!/usr/bin/env python3
"""Bundle OSM roads and infer connected road routes between source observations.

Uses only the Python standard library. See docs/road-methodology.md for limits.
Download once with --download (or supply an existing Overpass JSON with --input).
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import heapq
import json
import math
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = 'https://overpass.private.coffee/api/interpreter'
BBOX = [35.16, -98.35, 35.66, -97.65]  # south, west, north, east
HIGHWAYS = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|track|road'
QUERY = f'''[out:json][timeout:180];
way["highway"~"^({HIGHWAYS})$"]({','.join(map(str, BBOX))})->.roads;
rel(bw.roads)["type"="restriction"]->.restrictions;
node["place"~"^(city|town|village|hamlet|suburb|neighbourhood)$"]({','.join(map(str, BBOX))})->.places;
(.roads;.restrictions;.places;);(._;>;);out body;
'''
EARTH = 6371008.8
METERS_LAT = math.pi * EARTH / 180
METERS_LON = METERS_LAT * math.cos(math.radians(35.4))
SNAP_LIMIT = 75.0
MAX_MPH = 110.0
GRID = 150.0
CANDIDATE_LIMIT = 4


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def distance(a, b):
    """Haversine meters, lon/lat coordinates."""
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, math.radians(b[0] - a[0])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH * math.asin(min(1, math.sqrt(h)))


def xy(coord):
    return coord[0] * METERS_LON, coord[1] * METERS_LAT


def cumulative(coords):
    values = [0.0]
    for a, b in zip(coords, coords[1:]):
        values.append(values[-1] + distance(a, b))
    return values


def permitted(tags):
    # Conditional access cannot be resolved for the historical observation time.
    if any(key in tags for key in ('access:conditional', 'motor_vehicle:conditional', 'motorcar:conditional')):
        return False
    # A more specific vehicle permission overrides a generic access prohibition.
    for key in ('motorcar', 'motor_vehicle', 'vehicle', 'access'):
        if key in tags:
            if tags[key] in ('no', 'private', 'agricultural', 'forestry', 'delivery', 'customers', 'permit'):
                return False
            if tags[key] in ('yes', 'permissive', 'designated', 'destination'):
                return True
    return not any(key in tags for key in ('access:conditional', 'motor_vehicle:conditional', 'motorcar:conditional'))


def directions(tags):
    if any(key in tags for key in ('oneway:conditional', 'oneway:motor_vehicle:conditional', 'oneway:motorcar:conditional')):
        return False, False
    value = tags.get('oneway:motorcar', tags.get('oneway:motor_vehicle', tags.get('oneway')))
    if value in ('-1', 'reverse'):
        return False, True
    if value in ('yes', '1', 'true'):
        return True, False
    if value in ('no', '0', 'false'):
        return True, True
    if value in ('reversible', 'alternating'):
        return False, False  # direction at observation time is unknown
    if tags.get('junction') in ('roundabout', 'circular') or tags.get('highway') in ('motorway', 'motorway_link'):
        return True, False
    return True, True


class RoadGraph:
    def __init__(self, raw):
        self.raw = raw
        self.coords = {e['id']: [e['lon'], e['lat']] for e in raw['elements'] if e['type'] == 'node'}
        self.blocked_nodes = set()
        for element in raw['elements']:
            if element['type'] != 'node':
                continue
            tags = element.get('tags', {})
            explicit_vehicle_permission = any(tags.get(k) in ('yes', 'permissive', 'designated') for k in ('motorcar', 'motor_vehicle', 'vehicle'))
            barrier = tags.get('barrier') in ('wall', 'fence', 'bollard', 'block', 'jersey_barrier', 'cycle_barrier', 'bus_trap', 'sump_buster', 'gate', 'lift_gate', 'swing_gate', 'chain', 'stile', 'kissing_gate')
            if not permitted(tags) or (barrier and not explicit_vehicle_permission):
                self.blocked_nodes.add(element['id'])
        self.ways = [e for e in raw['elements'] if e['type'] == 'way' and e.get('tags', {}).get('highway') in HIGHWAYS.split('|')]
        self.segments = []
        self.grid = defaultdict(list)
        self.adj = defaultdict(list)
        self.restrictions = defaultdict(list)
        self.restriction_notes = []
        self.candidate_cache = {}
        self._virtual_id = -1
        self._routes = {}
        self.blocked_via_entries = set()
        for way in self.ways:
            tags = way.get('tags', {})
            if not permitted(tags):
                continue
            forward, reverse = directions(tags)
            if not forward and not reverse:
                continue
            for index, (u, v) in enumerate(zip(way['nodes'], way['nodes'][1:])):
                if u not in self.coords or v not in self.coords or u == v:
                    continue
                a, b = self.coords[u], self.coords[v]
                if distance(a, b) < 0.001:
                    continue
                segment = {'u': u, 'v': v, 'way': way['id'], 'key': len(self.segments),
                           'a': a, 'b': b, 'axy': xy(a), 'bxy': xy(b),
                           'forward': forward, 'reverse': reverse, 'splits': []}
                self.segments.append(segment)
                ax, ay = segment['axy']; bx, by = segment['bxy']
                for gx in range(math.floor(min(ax, bx) / GRID), math.floor(max(ax, bx) / GRID) + 1):
                    for gy in range(math.floor(min(ay, by) / GRID), math.floor(max(ay, by) / GRID) + 1):
                        self.grid[gx, gy].append(segment['key'])
        self._load_restrictions(raw)

    def _load_restrictions(self, raw):
        ways = {way['id']: way for way in self.ways}
        for item in raw['elements']:
            if item['type'] != 'relation' or item.get('tags', {}).get('type') != 'restriction':
                continue
            tags = item.get('tags', {})
            if any(x in tags.get('except', '').split(';') for x in ('motorcar', 'motor_vehicle', 'vehicle')):
                continue
            restriction = tags.get('restriction:motorcar', tags.get('restriction:motor_vehicle', tags.get('restriction', '')))
            members = item.get('members', [])
            frm = [m['ref'] for m in members if m['role'] == 'from' and m['type'] == 'way']
            to = [m['ref'] for m in members if m['role'] == 'to' and m['type'] == 'way']
            via_nodes = [m['ref'] for m in members if m['role'] == 'via' and m['type'] == 'node']
            via_ways = [m['ref'] for m in members if m['role'] == 'via' and m['type'] == 'way']
            if len(frm) == len(to) == len(via_nodes) == 1 and restriction.startswith(('no_', 'only_')):
                self.restrictions[via_nodes[0]].append((frm[0], to[0], restriction))
            elif via_ways and frm:
                # Exclude entry from the stated from-way to any via-way rather than
                # silently invent a legal path through a complex restriction.
                for fw in frm:
                    for vw in via_ways:
                        if fw in ways and vw in ways:
                            for node in set(ways[fw]['nodes']) & set(ways[vw]['nodes']):
                                self.blocked_via_entries.add((node, fw, vw))
                self.restriction_notes.append({'id': item['id'], 'treatment': 'Conservatively block from-way entry into via-way; complex restriction not reconstructed.'})
            else:
                self.blocked_nodes.update(via_nodes)
                self.restriction_notes.append({'id': item['id'], 'treatment': 'Incomplete restriction members; conservatively block passage through its via-node.', 'tags': tags})

    def candidates(self, lon, lat):
        cache_key = (lon, lat)
        if cache_key in self.candidate_cache:
            return self.candidate_cache[cache_key]
        px, py = xy([lon, lat]); nearby = set()
        for gx in range(math.floor((px - SNAP_LIMIT) / GRID), math.floor((px + SNAP_LIMIT) / GRID) + 1):
            for gy in range(math.floor((py - SNAP_LIMIT) / GRID), math.floor((py + SNAP_LIMIT) / GRID) + 1):
                nearby.update(self.grid.get((gx, gy), ()))
        found = []
        seen_nodes = set()
        for index in sorted(nearby):
            segment = self.segments[index]
            ax, ay = segment['axy']; bx, by = segment['bxy']
            fraction = max(0., min(1., ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
            a, b = segment['a'], segment['b']
            coord = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])]
            snap_distance = distance([lon, lat], coord)
            if snap_distance > SNAP_LIMIT:
                continue
            node = segment['u'] if fraction < 1e-10 else segment['v'] if fraction > 1 - 1e-10 else None
            if node is not None:
                coord = self.coords[node]
            if node is not None and node in seen_nodes:
                continue
            if node is not None:
                seen_nodes.add(node)
            found.append({'segment': index, 'fraction': fraction, 'coord': coord, 'distance': snap_distance, 'node': node})
        found.sort(key=lambda c: (c['distance'], c['segment']))
        found = found[:CANDIDATE_LIMIT]
        for candidate in found:
            if candidate['node'] is None:
                candidate['node'] = self._virtual_id
                self._virtual_id -= 1
                self.coords[candidate['node']] = candidate['coord']
                self.segments[candidate['segment']]['splits'].append((candidate['fraction'], candidate['node']))
        self.candidate_cache[cache_key] = found
        return found

    def finalize(self):
        for segment in self.segments:
            splits = [(0., segment['u']), *sorted(segment['splits']), (1., segment['v'])]
            for (_, u), (_, v) in zip(splits, splits[1:]):
                length = distance(self.coords[u], self.coords[v])
                # Keep zero-length edges when independent observations project to
                # exactly the same point; they join virtual nodes on the same edge.
                edge = (length, segment['way'], segment['key'])
                if u in self.blocked_nodes or v in self.blocked_nodes:
                    continue
                if segment['forward']:
                    self.adj[u].append((v, *edge))
                if segment['reverse']:
                    self.adj[v].append((u, *edge))

    def turn_allowed(self, node, in_way, in_segment, out_way, out_segment):
        if (node, in_way, out_way) in self.blocked_via_entries:
            return False
        for frm, to, rule in self.restrictions.get(node, ()):
            if frm != in_way:
                continue
            if rule == 'no_u_turn' and frm == to:
                if in_segment == out_segment:
                    return False
            elif rule.startswith('no_') and to == out_way:
                return False
            elif rule.startswith('only_'):
                if to != out_way:
                    return False
                if frm == to:
                    if rule == 'only_u_turn' and in_segment != out_segment:
                        return False
                    if rule != 'only_u_turn' and in_segment == out_segment:
                        return False
        return True

    def routes(self, source, targets, max_distance):
        key = (source, tuple(sorted(targets)), round(max_distance, 4))
        if key in self._routes:
            return self._routes[key]
        remaining = set(targets)
        result = {}
        start = (source, 0, -1)
        queue = [(0., start)]; costs = {start: 0.}; parents = {}
        while queue and remaining:
            cost, state = heapq.heappop(queue)
            if cost != costs[state] or cost > max_distance:
                continue
            node, in_way, in_segment = state
            if node in remaining:
                path = [node]; back = state
                while back in parents:
                    back = parents[back]; path.append(back[0])
                path.reverse()
                result[node] = (cost, path)
                remaining.remove(node)
            for nxt, length, way, segment in self.adj.get(node, ()):
                if not self.turn_allowed(node, in_way, in_segment, way, segment):
                    continue
                new_cost = cost + length
                # Preserve incoming edge only at a restriction node. Else future
                # admissibility is independent of which edge reached that node.
                nxt_state = (nxt, way, segment) if nxt in self.restrictions or any(x[0] == nxt for x in self.blocked_via_entries) else (nxt, 0, -1)
                if new_cost <= max_distance and new_cost < costs.get(nxt_state, math.inf):
                    costs[nxt_state] = new_cost
                    parents[nxt_state] = state
                    heapq.heappush(queue, (new_cost, nxt_state))
        self._routes[key] = result
        return result


def get_tracks():
    gps = json.loads((ROOT / 'GPS.json').read_text())['data']
    tracks = [{'id': 'smotley', 'name': 'Shane Motley', 'interpolationLimitSeconds': 300,
               'points': [{'time': p['time'], 'lat': float(p['-lat']), 'lon': float(p['-lon'])} for p in gps]}]
    tracks += json.loads((ROOT / 'data/spotters.json').read_text())['spotters']
    return sorted(tracks, key=lambda t: (t['id'] != 'smotley', t['id']))


def interval_block(track, a, b):
    seconds = timestamp(b['time']) - timestamp(a['time'])
    for flag in track.get('breakIntervals', []):
        if timestamp(a['time']) < timestamp(flag['end']) and timestamp(b['time']) > timestamp(flag['start']):
            return 'flagged', flag.get('reason', 'Flagged source interval.')
    if seconds <= 0 or seconds > track['interpolationLimitSeconds']:
        return 'gap', 'Source observation gap exceeds the interpolation limit.'
    return None


def infer_track(graph, track):
    points = track['points']
    candidates = [graph.candidates(p['lon'], p['lat']) for p in points]
    matrices = []
    for i, (a, b) in enumerate(zip(points, points[1:])):
        matrix = {}
        if not interval_block(track, a, b):
            max_distance = (timestamp(b['time']) - timestamp(a['time'])) * MAX_MPH * 0.44704
            targets = {c['node'] for c in candidates[i + 1]}
            for ai, ca in enumerate(candidates[i]):
                routes = graph.routes(ca['node'], targets, max_distance)
                for bi, cb in enumerate(candidates[i + 1]):
                    if cb['node'] in routes:
                        matrix[ai, bi] = routes[cb['node']]
        matrices.append(matrix)
    # Select one consistent road projection per observation. Maximize routable
    # adjacent intervals, then favor close snaps and short connected routes.
    scores = []; backpointers = []
    for i, choices in enumerate(candidates):
        options = choices or [None]
        row = []; back = []
        for j, choice in enumerate(options):
            emission = choice['distance'] ** 2 / 25 if choice else 0
            if i == 0:
                row.append(emission); back.append(None); continue
            possibilities = []
            blocked = interval_block(track, points[i - 1], points[i])
            for k, previous_score in enumerate(scores[-1]):
                route = matrices[i - 1].get((k, j))
                penalty = 0 if blocked or not candidates[i - 1] or not choices else (route[0] / 100 if route else 1_000_000)
                possibilities.append((previous_score + penalty + emission, k))
            best, prev = min(possibilities)
            row.append(best); back.append(prev)
        scores.append(row); backpointers.append(back)
    selected = [0] * len(points)
    selected[-1] = min(range(len(scores[-1])), key=scores[-1].__getitem__)
    for i in range(len(points) - 1, 0, -1):
        selected[i - 1] = backpointers[i][selected[i]]
    output_points = []
    for i, point in enumerate(points):
        candidate = candidates[i][selected[i]] if candidates[i] else None
        coord = candidate['coord'] if candidate else [point['lon'], point['lat']]
        output_points.append({'time': point['time'], 'lat': coord[1], 'lon': coord[0],
                              'originalLat': point['lat'], 'originalLon': point['lon'],
                              'roadMatched': candidate is not None,
                              'snapDistanceMeters': round(candidate['distance'], 3) if candidate else None,
                              'osmWayId': graph.segments[candidate['segment']]['way'] if candidate else None})
    intervals = []
    for i, (a, b) in enumerate(zip(points, points[1:])):
        interval = {'start': a['time'], 'end': b['time'], 'status': 'unmatched',
                    'coordinates': [], 'cumulativeMeters': [], 'distanceMeters': None, 'averageSpeedMph': None}
        blocked = interval_block(track, a, b)
        route = matrices[i].get((selected[i], selected[i + 1]))
        if blocked:
            interval.update(status=blocked[0], reason=blocked[1])
        elif not candidates[i] or not candidates[i + 1]:
            interval['reason'] = f'At least one observation has no eligible road within {SNAP_LIMIT:g} meters.'
        elif route is None:
            interval['reason'] = f'No connected legal road route within the {MAX_MPH:g} mph average-speed ceiling.'
        else:
            coords = []
            for node in route[1]:
                coordinate = graph.coords[node]
                if not coords or coordinate != coords[-1]:
                    coords.append(coordinate)
            if len(coords) == 1:
                coords.append(coords[0])
            lengths = cumulative(coords)
            speed = lengths[-1] / (timestamp(b['time']) - timestamp(a['time'])) / 0.44704
            assert speed <= MAX_MPH + 1e-6
            interval.update(status='stationary' if lengths[-1] < 0.01 else 'routed', coordinates=coords,
                            cumulativeMeters=[round(n, 3) for n in lengths], distanceMeters=round(lengths[-1], 3),
                            averageSpeedMph=round(speed, 3),
                            method='inferred-shortest-eligible-road-route',
                            routeAmbiguity='The actual road choice and within-interval speed are not established by the observations.')
        intervals.append(interval)
    result = {'id': track['id'], 'name': track['name'], 'interpolationLimitSeconds': track['interpolationLimitSeconds'],
              'points': output_points, 'intervals': intervals}
    if track.get('breakIntervals'):
        result['breakIntervals'] = track['breakIntervals']
    return result


def geojson(graph, source):
    features = []
    for way in graph.ways:
        coords = [graph.coords[n] for n in way['nodes'] if n in graph.coords]
        if len(coords) < 2:
            continue
        tags = way.get('tags', {})
        props = {'kind': 'road', 'osmId': way['id'], 'highway': tags['highway']}
        for key in ('name', 'ref', 'oneway', 'surface', 'access', 'motor_vehicle', 'service', 'bridge', 'tunnel'):
            if key in tags:
                props[key] = tags[key]
        props['routingEligible'] = permitted(tags) and any(directions(tags))
        features.append({'type': 'Feature', 'properties': props, 'geometry': {'type': 'LineString', 'coordinates': coords}})
    for item in graph.raw['elements']:
        tags = item.get('tags', {})
        if item['type'] == 'node' and tags.get('place') and tags.get('name'):
            features.append({'type': 'Feature', 'properties': {'kind': 'place', 'osmId': item['id'], 'name': tags['name'], 'place': tags['place']},
                             'geometry': {'type': 'Point', 'coordinates': [item['lon'], item['lat']]}})
    return {'type': 'FeatureCollection', 'source': source, 'features': features}


def download_map_api(destination):
    """One bounded regional vector extract; sequential map requests, never tiles."""
    elements = {}
    requests = []
    south, west, north, east = BBOX
    cache_dir = destination.parent / 'el-reno-osm-map-cache'
    cache_dir.mkdir(exist_ok=True)

    def part(bounds, label, depth=0):
        w, s, e, n = bounds
        url = 'https://api.openstreetmap.org/api/0.6/map?bbox=' + ','.join(f'{v:.8f}' for v in bounds)
        output = cache_dir / f'{label}.osm'
        if not output.exists():
            request = subprocess.run(['curl', '-sS', '-L', '--max-time', '90', '-w', '%{http_code}', url, '-o', str(output)], capture_output=True, text=True)
            if request.returncode:
                raise RuntimeError(f'Map API request failed: {request.stderr}')
            if request.stdout == '400' and 'too many nodes' in output.read_text():
                output.unlink()
                if depth >= 4:
                    raise RuntimeError('Repeated OSM API node-limit failure.')
                x, y = (w + e) / 2, (s + n) / 2
                for index, child in enumerate(((w, s, x, y), (x, s, e, y), (w, y, x, n), (x, y, e, n))):
                    part(child, f'{label}-{index}', depth + 1)
                return
            if request.stdout != '200':
                output.unlink(missing_ok=True)
                raise RuntimeError(f'Map API returned HTTP {request.stdout}.')
        payload = output.read_bytes()
        root = ET.fromstring(payload)
        for item in root:
            if item.tag not in ('node', 'way', 'relation'):
                continue
            value = {'type': item.tag, 'id': int(item.attrib['id'])}
            tags = {tag.attrib['k']: tag.attrib['v'] for tag in item.findall('tag')}
            if tags:
                value['tags'] = tags
            if item.tag == 'node':
                value.update(lat=float(item.attrib['lat']), lon=float(item.attrib['lon']))
            elif item.tag == 'way':
                value['nodes'] = [int(node.attrib['ref']) for node in item.findall('nd')]
            else:
                value['members'] = [{'type': member.attrib['type'], 'ref': int(member.attrib['ref']), 'role': member.attrib['role']} for member in item.findall('member')]
            elements[item.tag, value['id']] = value
        requests.append({'url': url, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})
        print(f'Fetched map extract {label}: {len(payload):,} bytes', flush=True)

    for row in range(4):
        for col in range(4):
            part((west + (east - west) * col / 4, south + (north - south) * row / 4,
                  west + (east - west) * (col + 1) / 4, south + (north - south) * (row + 1) / 4), f'{row}-{col}')
    ways = [e for (kind, _), e in elements.items() if kind == 'way' and e.get('tags', {}).get('highway') in HIGHWAYS.split('|')]
    way_ids = {w['id'] for w in ways}
    node_ids = {node for w in ways for node in w['nodes']}
    relations = [e for (kind, _), e in elements.items() if kind == 'relation' and e.get('tags', {}).get('type') == 'restriction' and any(m['type'] == 'way' and m['ref'] in way_ids for m in e['members'])]
    nodes = [e for (kind, _), e in elements.items() if kind == 'node' and (e['id'] in node_ids or e.get('tags', {}).get('place'))]
    result = {'version': 0.6, 'generator': 'OSM main map API XML, deduplicated by source ID',
              '_downloadProvenance': {'endpoint': 'https://api.openstreetmap.org/api/0.6/map', 'requests': requests},
              'elements': nodes + ways + relations}
    destination.write_text(json.dumps(result, separators=(',', ':')))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('/private/tmp/el-reno-osm.json'))
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--download-map-api', action='store_true')
    args = parser.parse_args()
    if args.download_map_api:
        download_map_api(args.input)
    if args.download:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.overpass') as query:
            query.write(QUERY); query.flush()
            subprocess.run(['curl', '-sS', '-L', '--fail', '--max-time', '240', '-A', 'ElRenoHistoricalMap/1.0',
                            '--data-urlencode', f'data@{query.name}', ENDPOINT, '-o', str(args.input)], check=True)
    payload = args.input.read_bytes()
    raw = json.loads(payload)
    if raw.get('remark'):
        raise ValueError(f'Overpass query incomplete: {raw["remark"]}')
    graph = RoadGraph(raw)
    tracks = get_tracks()
    for track in tracks:
        for point in track['points']:
            graph.candidates(point['lon'], point['lat'])
    graph.finalize()
    source = {'name': 'OpenStreetMap contributors', 'url': 'https://www.openstreetmap.org/copyright',
              'license': 'Open Database License (ODbL) 1.0', 'licenseUrl': 'https://opendatacommons.org/licenses/odbl/1-0/',
              'endpoint': raw.get('_downloadProvenance', {}).get('endpoint', ENDPOINT), 'osmBaseTimestamp': raw.get('osm3s', {}).get('timestamp_osm_base'),
              'retrievedAt': datetime.fromtimestamp(args.input.stat().st_mtime, timezone.utc).isoformat().replace('+00:00', 'Z'),
              'sha256': hashlib.sha256(payload).hexdigest(), 'bounds': BBOX,
              'query': QUERY if not raw.get('_downloadProvenance') else None,
              'mapApiRequests': raw.get('_downloadProvenance', {}).get('requests', []),
              'context': 'Present-day OSM road network; not a reconstruction of the roads open on May 31, 2013.'}
    outputs = {}
    for track in tracks:
        outputs[track['id']] = infer_track(graph, track)
        print(track['id'], dict(Counter(i['status'] for i in outputs[track['id']]['intervals'])), flush=True)
    counts = Counter(i['status'] for track in outputs.values() for i in track['intervals'])
    source_hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in ('GPS.json', 'data/spotters.json')}
    summary = {'tracks': len(outputs), 'observations': sum(len(t['points']) for t in outputs.values()),
               'matchedObservations': sum(p['roadMatched'] for t in outputs.values() for p in t['points']),
               'intervals': sum(counts.values()), 'intervalStatuses': dict(counts),
               'maximumSnapMeters': SNAP_LIMIT, 'maximumAverageSpeedMph': MAX_MPH,
               'osmRoadWays': len(graph.ways), 'routingSegments': len(graph.segments),
               'turnRestrictionNodes': len(graph.restrictions), 'blockedBarrierOrAccessNodes': len(graph.blocked_nodes), 'restrictionNotes': graph.restriction_notes}
    result = {'schemaVersion': 1, 'source': source, 'observationSourcesSha256': source_hashes,
              'method': 'Connected directed shortest road routes between nearby edge projections; constant distance rate per source interval. Inferred paths, not observed driving routes.',
              'tracks': outputs, 'summary': summary}
    for filename, value in [('roads.geojson', geojson(graph, source)), ('road-routes.json', result)]:
        destination = ROOT / 'data' / filename
        temporary = destination.with_suffix(destination.suffix + '.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
        temporary.replace(destination)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == '__main__':
    main()

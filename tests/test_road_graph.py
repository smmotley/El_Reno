"""Independent topology checks: python3 -m unittest discover -s tests -p 'test_road_graph.py'."""
import importlib.util
import json
import math
from collections import defaultdict
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'prepare_roads.py'
spec = importlib.util.spec_from_file_location('prepare_roads', SCRIPT)
roads = importlib.util.module_from_spec(spec)
spec.loader.exec_module(roads)


def node(identifier, x, y):
    return {'type': 'node', 'id': identifier, 'lon': -98 + x * .01, 'lat': 35.4 + y * .01}


def way(identifier, nodes, **tags):
    return {'type': 'way', 'id': identifier, 'nodes': nodes, 'tags': {'highway': 'residential', **tags}}


def restriction(identifier, before, after, via, rule):
    return {'type': 'relation', 'id': identifier, 'tags': {'type': 'restriction', 'restriction': rule},
            'members': [{'type': 'way', 'role': 'from', 'ref': before},
                        {'type': 'way', 'role': 'to', 'ref': after},
                        {'type': 'node', 'role': 'via', 'ref': via}]}


class RoadGraphEvidenceTests(unittest.TestCase):
    def graph(self, elements, finalize=True):
        graph = roads.RoadGraph({'elements': elements})
        if finalize:
            graph.finalize()
        return graph

    def test_crossing_roads_without_shared_osm_node_do_not_connect(self):
        graph = self.graph([node(1, -1, 0), node(2, 1, 0), node(3, 0, -1), node(4, 0, 1),
                            way(11, [1, 2]), way(12, [3, 4])])
        self.assertEqual(graph.routes(1, {4}, 10000), {})

    def test_l_route_uses_real_corner_and_never_diagonal_endpoint_connector(self):
        graph = self.graph([node(1, 0, 0), node(2, 1, 0), node(3, 1, 1), way(11, [1, 2, 3])])
        distance, path = graph.routes(1, {3}, 10000)[3]
        self.assertEqual(path, [1, 2, 3])
        self.assertGreater(distance, roads.distance(graph.coords[1], graph.coords[3]) * 1.3)

    def test_projection_splits_existing_edge_and_preserves_its_direction(self):
        graph = self.graph([node(1, 0, 0), node(2, 2, 0), way(11, [1, 2], oneway='yes')], False)
        a = graph.candidates(-97.995, 35.4001)[0]
        b = graph.candidates(-97.985, 35.4001)[0]
        graph.finalize()
        _, path = graph.routes(a['node'], {b['node']}, 10000)[b['node']]
        self.assertEqual(path, [a['node'], b['node']])
        self.assertTrue(all(abs(graph.coords[n][1] - 35.4) < 1e-12 for n in path))
        self.assertEqual(graph.routes(b['node'], {a['node']}, 10000), {})

    def test_reverse_oneway_and_motor_vehicle_prohibition_are_respected(self):
        graph = self.graph([node(1, 0, 0), node(2, 1, 0), node(3, 2, 0),
                            way(11, [1, 2], oneway='-1'), way(12, [2, 3], motor_vehicle='no')])
        self.assertEqual(graph.routes(1, {2}, 10000), {})
        self.assertEqual(graph.routes(2, {1}, 10000)[1][1], [2, 1])
        self.assertEqual(graph.routes(2, {3}, 10000), {})

    def test_node_turn_restriction_prevents_an_otherwise_connected_path(self):
        graph = self.graph([node(1, 0, 0), node(2, 1, 0), node(3, 1, 1),
                            way(11, [1, 2], oneway='yes'), way(12, [2, 3], oneway='yes'),
                            restriction(20, 11, 12, 2, 'no_left_turn')])
        self.assertEqual(graph.routes(1, {3}, 10000), {})

    def test_vehicle_barrier_and_unresolved_conditional_direction_are_not_routed(self):
        gate = node(2, 1, 0)
        gate['tags'] = {'barrier': 'gate'}
        elements = [node(1, 0, 0), gate, node(3, 2, 0), way(11, [1, 2, 3])]
        self.assertEqual(self.graph(elements).routes(1, {3}, 10000), {})
        gate['tags']['motor_vehicle'] = 'yes'
        self.assertIn(3, self.graph(elements).routes(1, {3}, 10000))
        conditional = self.graph([node(1, 0, 0), node(2, 1, 0),
                                  way(11, [1, 2], **{'oneway:conditional': 'yes @ (Mo-Fr)'})])
        self.assertEqual(conditional.routes(1, {2}, 10000), {})

    def test_same_way_only_straight_on_excludes_reversal(self):
        graph = self.graph([node(1, 0, 0), node(2, 1, 0), node(3, 2, 0), way(11, [1, 2, 3]),
                            restriction(20, 11, 11, 2, 'only_straight_on')])
        self.assertTrue(graph.turn_allowed(2, 11, 0, 11, 1))
        self.assertFalse(graph.turn_allowed(2, 11, 0, 11, 0))

    def test_same_way_only_u_turn_excludes_continuing_straight(self):
        graph = self.graph([node(1, 0, 0), node(2, 1, 0), node(3, 2, 0), way(11, [1, 2, 3]),
                            restriction(20, 11, 11, 2, 'only_u_turn')])
        self.assertTrue(graph.turn_allowed(2, 11, 0, 11, 0))
        self.assertFalse(graph.turn_allowed(2, 11, 0, 11, 1))

    def test_snap_limit_and_route_distance_budget_bound_inference(self):
        graph = self.graph([node(1, 0, 0), node(2, 1, 0), way(11, [1, 2])], False)
        self.assertEqual(graph.candidates(-97.995, 35.401), [])
        self.assertTrue(graph.candidates(-97.995, 35.4001))
        graph.finalize()
        distance = roads.distance(graph.coords[1], graph.coords[2])
        self.assertEqual(graph.routes(1, {2}, distance - 1), {})
        self.assertIn(2, graph.routes(1, {2}, distance + 1))

    def test_declared_source_breaks_win_over_short_duration(self):
        track = {'interpolationLimitSeconds': 120, 'breakIntervals': [
            {'start': '2013-05-31T23:16:41Z', 'end': '2013-05-31T23:17:00Z', 'reason': 'Source jump'}]}
        a, b = {'time': '2013-05-31T23:16:41Z'}, {'time': '2013-05-31T23:17:00Z'}
        self.assertEqual(roads.interval_block(track, a, b)[0], 'flagged')
        self.assertEqual(roads.interval_block(track, a, {'time': '2013-05-31T23:20:00Z'})[0], 'flagged')
        self.assertEqual(roads.interval_block({'interpolationLimitSeconds': 120}, a, {'time': '2013-05-31T23:20:00Z'})[0], 'gap')

    def test_all_bundled_routed_segments_lie_on_real_osm_road_edges(self):
        """Independently reject fabricated diagonal connectors in the final data."""
        root = SCRIPT.parents[1]
        features = json.loads((root / 'data' / 'roads.geojson').read_text())['features']
        tracks = json.loads((root / 'data' / 'road-routes.json').read_text())['tracks']
        grid_size = 250
        index = defaultdict(list)
        for feature in features:
            if feature['geometry']['type'] != 'LineString' or not feature['properties'].get('routingEligible'):
                continue
            points = feature['geometry']['coordinates']
            for first, second in zip(points, points[1:]):
                a, b = roads.xy(first), roads.xy(second)
                for x in range(math.floor(min(a[0], b[0]) / grid_size), math.floor(max(a[0], b[0]) / grid_size) + 1):
                    for y in range(math.floor(min(a[1], b[1]) / grid_size), math.floor(max(a[1], b[1]) / grid_size) + 1):
                        index[x, y].append((a, b))

        def lies_on(point, a, b):
            dx, dy = b[0] - a[0], b[1] - a[1]
            square = dx * dx + dy * dy
            if square == 0:
                return math.hypot(point[0] - a[0], point[1] - a[1]) < .05
            fraction = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / square
            cross_distance = abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / math.sqrt(square)
            return -.000001 <= fraction <= 1.000001 and cross_distance < .05

        checked = 0
        for track in tracks.values():
            for interval in track['intervals']:
                if interval['status'] != 'routed':
                    continue
                for first, second in zip(interval['coordinates'], interval['coordinates'][1:]):
                    a, b = roads.xy(first), roads.xy(second)
                    if a == b:
                        continue
                    cell = (math.floor((a[0] + b[0]) / 2 / grid_size), math.floor((a[1] + b[1]) / 2 / grid_size))
                    candidates = index[cell]
                    self.assertTrue(any(lies_on(a, c, d) and lies_on(b, c, d) for c, d in candidates),
                                    f"{track['id']} has a non-road connector at {interval['start']}: {first} to {second}")
                    checked += 1
        self.assertGreater(checked, 1000)


if __name__ == '__main__':
    unittest.main()

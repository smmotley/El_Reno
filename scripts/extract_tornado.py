#!/usr/bin/env python3
"""Rebuild the tornado layers from the unmodified official NWS KMZ.

Only the Python standard library is required. Run from any directory:
    python3 scripts/extract_tornado.py
"""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/source/ElRenoTornadoPath_final.kmz"
SOURCE_URL = "https://www.weather.gov/source/oun/wxevents/20130531/gis/ElRenoTornadoPath_final.kmz"
PAGE_URL = "https://www.weather.gov/oun/events-20130531"
MAP_URL = "https://www.weather.gov/images/oun/wxevents/20130531/maps/elreno_tornado_ef0contour_with_times.jpg"
NS = {"k": "http://www.opengis.net/kml/2.2"}


def coordinates(element):
    """KML coordinates are longitude, latitude, altitude. Drop only altitude."""
    return [[float(n) for n in coordinate.split(",")[:2]]
            for coordinate in element.text.split()]


def utc_time(label):
    hour, minute = map(int, label.split(":"))
    local = datetime(2013, 5, 31, hour + 12, minute,
                     tzinfo=ZoneInfo("America/Chicago"))
    return local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def event(local_time, title, detail, **extra):
    return {"time": utc_time(local_time), "title": title,
            "detail": detail, "sourceUrl": PAGE_URL, **extra}


def main():
    with ZipFile(SOURCE) as archive:
        root = ET.fromstring(archive.read("doc.kml"))
    features, points = [], []
    for placemark in root.findall(".//k:Placemark", NS):
        name = placemark.findtext("k:name", namespaces=NS)
        props = {"sourceName": name, "sourceUrl": SOURCE_URL,
                 "sourceOrganization": "NWS Norman", "uncertaintyMeters": None}
        polygon = placemark.find("k:Polygon", NS)
        line = placemark.find("k:LineString", NS)
        point = placemark.find("k:Point/k:coordinates", NS)
        if polygon is not None:
            rings = [coordinates(r) for r in polygon.findall(".//k:LinearRing/k:coordinates", NS)]
            assert all(r[0] == r[-1] for r in rings), "Unclosed source polygon"
            props.update({"name": "NWS surveyed tornado swath", "kind": "surveyed-swath",
                          "interpretation": "Full-event tornado contour; not an instantaneous edge or the extent of all damaging winds."})
            geometry = {"type": "Polygon", "coordinates": rings}
            features.append({"type": "Feature", "id": "nws-tornado-swath",
                             "properties": props, "geometry": geometry})
        elif line is not None:
            props.update({"name": "NWS estimated tornado center path", "kind": "center-path",
                          "interpretation": "Published estimated center path; vertices do not themselves have timestamps."})
            geometry = {"type": "LineString", "coordinates": coordinates(line.find("k:coordinates", NS))}
            features.append({"type": "Feature", "id": "nws-center-path",
                             "properties": props, "geometry": geometry})
        elif point is not None and re.fullmatch(r"6:\d{2}", name or ""):
            lon, lat = coordinates(point)[0]
            # A KML LookAt is a camera position: it must never be used as the point.
            points.append({"time": utc_time(name), "lat": lat, "lon": lon,
                           "sourceLabel": f"{name} PM CDT", "kind": "estimated-center"})
        else:
            raise ValueError(f"Unexpected source placemark: {name!r}")
    points.sort(key=lambda p: p["time"])
    assert len(features) == 2 and len(points) == 39
    assert points[0]["time"] == "2013-05-31T23:04:00Z"
    assert points[-1]["time"] == "2013-05-31T23:42:00Z"
    times = [datetime.fromisoformat(p["time"].replace("Z", "+00:00")) for p in points]
    assert all((b-a).total_seconds() == 60 for a, b in zip(times, times[1:]))
    assert all(-99 < p["lon"] < -97 and 35 < p["lat"] < 36 for p in points)

    provenance = {"sourceUrl": SOURCE_URL, "sourcePageUrl": PAGE_URL,
                  "sourceImageUrl": MAP_URL, "sourceRetrievedDate": "2026-11-04",
                  "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest()}
    geojson = {"type": "FeatureCollection", **provenance, "features": features}
    timeline = {
        **provenance,
        "name": "NWS estimated tornado center positions",
        "status": "available",
        "method": "Direct extraction of 39 time-labeled Point placemarks from the official NWS KMZ; no image digitization or synthetic points.",
        "sourceTimezone": "America/Chicago",
        "timeInterpretation": "The KMZ 6:04–6:42 labels are evening CDT (UTC−05:00), consistent with the NWS companion map and event narrative. Converted to 23:04–23:42 UTC.",
        "timeResolutionSeconds": 60,
        "uncertaintyMeters": None,
        "uncertaintyNote": "NWS does not publish a spatial or clock confidence interval with these points. Coordinate precision does not establish position accuracy. Center distance is approximate and does not measure distance to a subvortex or tornado edge.",
        "interpolation": {"method": "linear-between-timed-centers", "maximumGapSeconds": 60,
                          "extrapolate": False,
                          "note": "Between minute marks the displayed center is an interpolation, not a new observation. Linear interpolation may simplify turns and the loop."},
        "sourceDiscrepancy": "The NWS narrative gives dissipation at 6:42 PM CDT; its tornado table lists an end at 6:44 PM CDT. The KMZ ends at 6:42. No center positions are fabricated for 6:03 or after 6:42.",
        "points": points,
        "events": [
            event("6:03", "Tornado develops", "NWS places genesis northeast of Heaston and Reuter roads. First timed KMZ center is one minute later."),
            event("6:09", "Turns east", "NWS describes an eastward turn south of Reno Road."),
            event("6:19", "Crosses US 81", "The expanding tornado crosses US 81 near Reno Road and accelerates northward."),
            event("6:24", "Maximum size and intensity period", "NWS identifies 6:24–6:26 PM CDT near Radio and Reuter roads.", endTime=utc_time("6:26")),
            event("6:27", "Loop north of I-40", "The center loops while slowing; NWS places this phase at 6:27–6:35 PM CDT.", endTime=utc_time("6:35")),
            event("6:42", "Last published center point", "KMZ ends at 6:42 PM CDT. NWS narrative gives dissipation here; its tornado table gives 6:44 PM CDT.")
        ]
    }
    for filename, obj in (("tornado.geojson", geojson), ("tornado-timeline.json", timeline)):
        (ROOT / "data" / filename).write_text(json.dumps(obj, indent=2) + "\n")
    print(f"Extracted {len(features)} geometries and {len(points)} timed centers.")
    print(f"Source SHA-256: {provenance['sourceSha256']}")


if __name__ == "__main__":
    main()

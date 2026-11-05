#!/usr/bin/env python3
"""Prepare local originals as seekable H.264/AAC MP4; never edit source movies.

Needs ffmpeg/ffprobe on PATH. At most two conversions run concurrently. Metadata
clock fields and filename clocks are inventory only, never synchronization input.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from fractions import Fraction
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/movies'
WEB = SOURCE / 'web'
CACHE = ROOT / '.cache/chase-videos'
MANIFEST = ROOT / 'data/chase-videos.json'
SETTINGS = {'videoCodec': 'libx264', 'audioCodec': 'aac', 'preset': 'veryfast', 'crf': 22,
            'maxWidth': 1920, 'maxHeight': 1080, 'pixelFormat': 'yuv420p', 'keyframeSeconds': 1,
            'hdvDeinterlace': 'bwdif send_frame, automatic field parity', 'faststart': True,
            'retimed': False, 'frozenFramesAdded': False}
STARTS = {'120351': '23:02:40', '120459': '23:04:40', '120959': '23:09:20',
          '121054': '23:10:30', 'dsc-0771': '23:10:17'}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def probe(path):
    result = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams',
                                               '-of', 'json', str(path)], text=True))
    result['format']['filename'] = path.relative_to(ROOT).as_posix()
    return result


def atom_order(path):
    result = []
    with path.open('rb') as stream:
        while stream.tell() < path.stat().st_size:
            offset = stream.tell()
            header = stream.read(8)
            if len(header) != 8:
                raise ValueError('Incomplete MP4 atom header')
            size, kind = struct.unpack('>I4s', header)
            if size == 1:
                size = struct.unpack('>Q', stream.read(8))[0]
            if size == 0:
                size = path.stat().st_size - offset
            if size < 8:
                raise ValueError('Invalid MP4 atom size')
            result.append(kind.decode('ascii'))
            stream.seek(offset + size)
    return result


def inventory(path):
    source_probe = probe(path)
    hdv = '(id)' in path.name
    token = path.name.split(' ')[1].replace('_', '') if hdv else path.stem.lower().replace('_', '-')
    identity = 'hdv-' + token if hdv else token
    camera = 'our' if hdv else 'brendon' if token == 'dsc-0771' else 'unassigned'
    creator = {'our': 'Our vehicle', 'brendon': 'Brendon', 'unassigned': 'Unassigned camera'}[camera]
    start = '2013-05-31T' + STARTS[token] + '.000Z' if token in STARTS else None
    status = 'provisional' if token == '120351' else 'user-supplied' if start else 'unregistered'
    notes = ['Filename and embedded camera dates are not used to set this clip\'s start time.']
    calibration = {'status': status, 'source': 'user' if start else None,
                   'basis': 'User-provided May 31, 2013 Oklahoma local start; CDT is UTC−05:00.' if start else 'No verified start time supplied; browse independently of the map clock.'}
    if status == 'provisional':
        calibration.update(originalApproximateStartTime='2013-05-31T23:03:30.000Z',
                           stopReference={'videoOffsetSeconds': 16, 'latitude': 35.44883333333333, 'longitude': -98.07538888888888,
                                          'requestedTrackStopStart': '2013-05-31T23:02:56.000Z',
                                          'requestedTrackStopEnd': '2013-05-31T23:03:48.000Z'})
        notes.append('Start provisionally adjusted to 6:02:40 PM CDT for the requested road-stop reconstruction. Video playback remains continuous; the clip ends before the requested stop ends.')
    if camera == 'unassigned':
        notes.append('Camera ownership and clock calibration have not been confirmed. Similar encoding metadata does not establish who recorded this clip.')
    return {'id': identity, 'title': creator + ' · ' + (path.name.split(' ')[1] if hdv else path.stem),
            'camera': camera, 'creator': creator, 'sourcePath': path.relative_to(ROOT).as_posix(),
            'path': (WEB / (identity + '.mp4')).relative_to(ROOT).as_posix(),
            'posterPath': (WEB / (identity + '.jpg')).relative_to(ROOT).as_posix(),
            'startTime': start, 'durationSeconds': float(source_probe['format']['duration']),
            'calibration': calibration, 'notes': notes, 'ready': False,
            'media': {'source': {'bytes': path.stat().st_size, 'sha256': sha(path), 'probe': source_probe}}}


def convert(clip, force):
    source = ROOT / clip['sourcePath']; target = ROOT / clip['path']; record_path = CACHE / (clip['id'] + '.json')
    if not force and target.exists() and record_path.exists():
        old = json.loads(record_path.read_text())
        if old['sourceSha256'] == clip['media']['source']['sha256'] and old['settings'] == SETTINGS and sha(target) == old['web']['sha256']:
            old['web']['probe']['format']['filename'] = clip['path']
            clip['media']['web'] = old['web']; clip['durationSeconds'] = old['web']['durationSeconds']; clip['ready'] = True
            return clip
    info = clip['media']['source']['probe']; video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    is_hdv = video['codec_name'] == 'mpeg2video' and video.get('field_order') not in ('progressive', None)
    # HDV's 1440x1080 samples have 4:3 pixel aspect: the display is 1920x1080.
    # Nikon records full-range luma; convert range while retaining source matrix/transfer metadata.
    filters = (['bwdif=mode=send_frame:parity=auto:deint=all'] if is_hdv else [])
    filters += ['scale=1920:1080:flags=lanczos:out_range=limited', 'setsar=1']
    if video['width'] > 1920 or video['height'] > 1080 or video.get('display_aspect_ratio') != '16:9':
        raise ValueError('Review scaling for unexpected source dimensions/aspect: ' + source.name)
    rate = float(Fraction(video['avg_frame_rate'])); keyframes = round(rate)
    part = target.with_suffix('.part.mp4')
    command = ['ffmpeg', '-hide_banner', '-nostdin', '-y', '-i', str(source), '-map', '0:v:0', '-map', '0:a:0?',
               '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', '-vf', ','.join(filters),
               '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
               '-profile:v', 'high', '-level:v', '4.1', '-threads', '4', '-g', str(keyframes),
               '-keyint_min', str(keyframes), '-sc_threshold', '0', '-fps_mode', 'passthrough',
               '-color_range', 'tv', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', str(part)]
    print('Converting ' + source.name, flush=True)
    with (CACHE / (clip['id'] + '.log')).open('w') as log:
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
    web_probe = probe(part); output_video = next(s for s in web_probe['streams'] if s['codec_type'] == 'video')
    web_probe['format']['filename'] = clip['path']
    output_audio = next((s for s in web_probe['streams'] if s['codec_type'] == 'audio'), None)
    duration = float(web_probe['format']['duration']); source_duration = float(info['format']['duration'])
    atoms = atom_order(part)
    if output_video['codec_name'] != 'h264' or output_video['pix_fmt'] != 'yuv420p' or (output_audio and output_audio['codec_name'] != 'aac'):
        raise ValueError('Unexpected output codec/pixel format')
    if atoms.index('moov') > atoms.index('mdat') or abs(duration - source_duration) > .15 or abs(float(output_video.get('start_time', 0))) > .05:
        raise ValueError(f'Output duration/timing/faststart validation failed: {source.name}, source {source_duration}, output {duration}')
    part.replace(target)
    poster = ROOT / clip['posterPath']
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', '1', '-i', str(target),
                    '-frames:v', '1', '-vf', 'scale=640:360', '-q:v', '3', str(poster)], check=True)
    web = {'bytes': target.stat().st_size, 'sha256': sha(target), 'durationSeconds': duration,
           'videoDurationSeconds': float(output_video['duration']), 'durationDifferenceSeconds': round(duration-source_duration, 9),
           'faststartVerified': True, 'topLevelAtoms': atoms, 'probe': web_probe}
    record_path.write_text(json.dumps({'sourceSha256': clip['media']['source']['sha256'], 'settings': SETTINGS, 'command': command, 'web': web}, indent=2) + '\n')
    clip['media']['web'] = web; clip['durationSeconds'] = duration; clip['ready'] = True
    print(f'Ready {clip["id"]}: {duration:.3f}s, {web["bytes"]/1048576:.1f} MiB', flush=True)
    return clip


def publish(clips):
    result = {'schemaVersion': 1, 'timezone': 'America/Chicago', 'date': '2013-05-31',
              'sourceNotes': 'Original local recordings supplied by the user. Only explicit user timing anchors synchronize clips; source metadata is preserved as evidence, not accepted as clock calibration. Unsynchronized clips remain independently viewable.',
              'playback': {'continuous': True, 'retimed': False, 'frozenFramesAdded': False},
              'preparation': SETTINGS, 'clipCount': len(clips), 'readyCount': sum(c['ready'] for c in clips),
              'sourceBytes': sum(c['media']['source']['bytes'] for c in clips),
              'webBytes': sum(c['media'].get('web', {}).get('bytes', 0) for c in clips), 'clips': clips}
    part = MANIFEST.with_suffix('.json.tmp'); part.write_text(json.dumps(result, indent=2) + '\n'); part.replace(MANIFEST)


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--force', action='store_true'); parser.add_argument('--workers', type=int, default=2); args = parser.parse_args()
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise SystemExit('Install ffmpeg/ffprobe before preparing local media.')
    WEB.mkdir(exist_ok=True); CACHE.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in SOURCE.iterdir() if p.is_file() and p.suffix.lower() in ('.mov', '.mp4'))
    clips = [inventory(p) for p in files]; publish(clips)
    priorities = {'hdv-121054': 0, 'dsc-0771': 1, 'hdv-120959': 2, 'hdv-120459': 3, 'hdv-120351': 4}
    jobs = sorted(clips, key=lambda c: priorities.get(c['id'], 10))
    with ThreadPoolExecutor(max_workers=max(1, min(2, args.workers))) as pool:
        futures = [pool.submit(convert, clip, args.force) for clip in jobs]
        for future in as_completed(futures):
            future.result(); publish(clips)
    # Re-read source hashes to verify the preparation did not alter any originals.
    if any(sha(ROOT / c['sourcePath']) != c['media']['source']['sha256'] for c in clips):
        raise RuntimeError('An original source changed during preparation.')
    publish(clips)
    print(f'Complete: {len(clips)} clips, {sum(c["media"]["web"]["bytes"] for c in clips)/1048576:.1f} MiB browser video; originals unchanged.', flush=True)


if __name__ == '__main__':
    main()

# Fetches every sound listed in audio/assets.json from Freesound (HQ preview), after
# checking on the sound's own page that it is still CC0. Run: python3 -I scripts/fetch-sounds.py
import json, os, re, sys, urllib.request
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
UA = {'User-Agent': 'Mozilla/5.0 (axis-launch-film asset fetch)'}
get = lambda url: urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
manifest_path = os.path.join(ROOT, 'audio', 'assets.json')
manifest = json.load(open(manifest_path))
out_dir = os.path.join(ROOT, 'audio', 'sources', 'freesound')
os.makedirs(out_dir, exist_ok=True)
ok = True
for s in manifest['sounds']:
    page = get(f"https://freesound.org/s/{s['id']}/").decode('utf8', 'replace')
    lic = re.search(r'href="(https?://creativecommons\.org/[^"]+)"', page)
    url = re.search(r'<meta property="og:url" content="([^"]*)"', page)
    ogg = re.search(r'data-ogg="([^"]*)"', page)
    s['license'] = lic.group(1) if lic else 'UNKNOWN'
    s['url'] = url.group(1) if url else f"https://freesound.org/s/{s['id']}/"
    if 'publicdomain/zero/1.0' not in s['license']:
        print('NOT CC0, skipped:', s['id'], s['license']); ok = False; continue
    dest = os.path.join(out_dir, f"{s['id']}.ogg")
    if not os.path.exists(dest):
        open(dest, 'wb').write(get(ogg.group(1).replace('-lq.', '-hq.')))
    s['file'] = os.path.relpath(dest, ROOT)
    print(f"{s['id']:>7}  CC0  {s['user']:<18} {s['title']}")
json.dump(manifest, open(manifest_path, 'w'), indent=2)
open(manifest_path, 'a').write('\n')
sys.exit(0 if ok else 1)

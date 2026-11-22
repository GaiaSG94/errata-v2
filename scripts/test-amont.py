import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

MODE = sys.argv[1] if len(sys.argv) > 1 else "direct"
IMAGE = "corpus/demo/copie-demo-1.jpg"
MODELE = sys.argv[2] if len(sys.argv) > 2 else "ag/gemini-4-carbon"

key = os.environ.get("INFERHUB_API_KEY", "")
print("cle presente:", bool(key))

ua = {
    "content-type": "application/json",
    "authorization": "Bearer " + key,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0",
}

with open(IMAGE, "rb") as f:
    d = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

charge = {
    "model": MODELE,
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Liste les fautes de cette copie corrigee, format E01..E12."},
                {"type": "image_url", "image_url": {"url": d}},
            ],
        }
    ],
}

url = (
    "https://api.inferhub.dev/v1/chat/completions"
    if MODE == "direct"
    else "https://errata-proxy.rature.workers.dev/analyze"
)
if MODE != "direct":
    ua["Origin"] = "https://gaiasg94.github.io"

t = time.time()
try:
    r = urllib.request.urlopen(
        urllib.request.Request(url, data=json.dumps(charge).encode(), headers=ua, method="POST"),
        timeout=180,
    )
    print("HTTP", r.status, "en %.1f s" % (time.time() - t))
    corps = json.loads(r.read().decode())
    if MODE == "direct":
        print("modele:", corps.get("model"))
        print("contenu (300):", str(corps.get("choices", [{}])[0].get("message", {}).get("content", ""))[:300])
    else:
        print("cles:", sorted(corps.keys()))
        print("modele:", corps.get("modele"), "| tentatives:", corps.get("tentatives"))
        print("contenu (300):", str(corps.get("texte", ""))[:300])
except urllib.error.HTTPError as e:
    print("HTTP", e.code, "en %.1f s" % (time.time() - t), e.read().decode()[:250])

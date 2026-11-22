import base64
import json
import sys
import time
import urllib.error
import urllib.request

PROXY = "https://errata-proxy.rature.workers.dev/analyze"
IMAGE = sys.argv[1] if len(sys.argv) > 1 else "corpus/demo/copie-demo-1.jpg"
MODELE = sys.argv[2] if len(sys.argv) > 2 else "ag/gemini-4-carbon"

ua = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36",
    "Origin": "https://gaiasg94.github.io",
    "content-type": "application/json",
}

with open(IMAGE, "rb") as f:
    data_url = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

charge = {
    "model": MODELE,
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Voici la copie d'un eleve, corrigee par son professeur. "
                        "Les annotations du professeur sont en rouge. "
                        "Repere chaque faute de l'eleve et indique son type "
                        "parmi E01 a E12, puis la plus grave. "
                        "Reponds en JSON : {\"fautes\":[{\"code\":\"E01\","
                        "\"description\":\"...\",\"confiance\":0.9}]}."
                    ),
                },
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }
    ],
}

debut = time.time()
req = urllib.request.Request(PROXY, data=json.dumps(charge).encode(), headers=ua, method="POST")
try:
    rep = urllib.request.urlopen(req, timeout=120)
    corps = json.loads(rep.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:300])
    sys.exit(1)

print("duree: %.1f s" % (time.time() - debut))
print("modele:", corps.get("modele"))
print("cles:", sorted(corps.keys()))
texte = corps.get("texte", "")
print("texte (600 premiers caracteres):")
print(texte[:600])

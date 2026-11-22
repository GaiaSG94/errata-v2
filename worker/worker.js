/**
 * Variante Cloudflare Worker du proxy (§18.1) — même contrat que le proxy
 * Modal, zéro dépendance. Le quota est en mémoire par isolate : c'est une
 * approximation assumée (un Worker redémarre souvent), suffisante pour borner
 * un quota de démo.
 *
 * Ce Worker ne parle pas SSE : le champ `stream` est retiré avant le relais,
 * la réponse reste JSON et le client retombe sur son chemin classique.
 *
 * Comme le proxy Modal, il descend **la chaîne de modèles côté serveur** :
 * InferHub est une place de marché, un modèle peut être sans capacité
 * (503) ou hors enchère (402) d'une minute à l'autre.
 *
 * Déploiement : `wrangler deploy worker/worker.js --name errata-proxy`
 * puis `wrangler secret put INFERHUB_API_KEY`.
 */

const TAILLE_MAX = 15 * 1024 * 1024
const PAR_IP_PAR_HEURE = 20
const HEURE_MS = 60 * 60 * 1000
const COOLDOWN_S = 60
const DELAI_AMONT_MS = 60_000
const REESSAYABLES = new Set([402, 429, 500, 502, 503, 504])

const historique = new Map()
const horsService = new Map()

const ORIGINES = [
  'https://gaiasg94.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

/** Chaîne serveur, alignée sur CHAINE_MODELES de src/domain/config.ts. */
const CHAINE = [
  'ag/gemini-4-carbon',
  'ag/claude-sonnet-4-6',
  'ag/gemini-4-argon',
  'ag/claude-sonnet-5-5',
  'ag/gemini-3.8-flash-high',
  'zai/glm-4.6v',
  'ag/claude-opus-4-6-thinking',
]

const AMONT = 'https://api.inferhub.dev/v1'

/** L'en-tête CORS n'est renvoyé que pour une origine connue. */
function entetesCors(request) {
  const origine = request.headers.get('origin')
  if (!origine || !ORIGINES.includes(origine)) return {}
  return {
    'access-control-allow-origin': origine,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-rature-cle',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

function autoriser(id, maintenant) {
  const fenetre = (historique.get(id) || []).filter((t) => maintenant - t < HEURE_MS)
  if (fenetre.length >= PAR_IP_PAR_HEURE) {
    historique.set(id, fenetre)
    return false
  }
  fenetre.push(maintenant)
  historique.set(id, fenetre)
  return true
}

function json(corps, statut = 200, cors = {}) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...cors,
    },
  })
}

function empreinte(ip) {
  let h = 0
  for (let i = 0; i < ip.length; i += 1) h = (h * 31 + ip.charCodeAt(i)) >>> 0
  return `v${h.toString(36)}`
}

/** Un modèle mort (402/503) n'est pas retenté pendant 60 s. */
function disponible(modele, maintenant) {
  return (horsService.get(modele) || 0) <= maintenant
}

function signaler(modele, maintenant, panne) {
  if (panne) horsService.set(modele, maintenant + COOLDOWN_S)
  else horsService.delete(modele)
}

function etatDisjoncteur(maintenant) {
  const etat = {}
  for (const [modele, fin] of horsService) if (fin > maintenant) etat[modele] = Number((fin - maintenant).toFixed(1))
  return etat
}

/** Modèle demandé d'abord, puis le reste de la chaîne, sans doublon. */
function chainePour(demande) {
  if (!demande) return [...CHAINE]
  return [demande, ...CHAINE.filter((m) => m !== demande)]
}

/** Un appel à l'amont : JSON en entrée, `{statut, texte|erreur}` en sortie. Sur
 *  429 (« retry shortly »), une seule pause de 3 s avant de rendre la main. */
async function appelerAmont(charge, modele, cle) {
  const tenter = () =>
    fetch(`${AMONT}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cle}` },
      body: JSON.stringify({ ...charge, model: modele }),
      signal: AbortSignal.timeout(DELAI_AMONT_MS),
    })
  let reponse = await tenter()
  if (reponse.status === 429) {
    await new Promise((resoudre) => setTimeout(resoudre, 3000))
    reponse = await tenter()
  }
  const data = await reponse.json()
  if (reponse.status === 200) {
    const texte = data?.choices?.[0]?.message?.content || ''
    if (!texte) return { statut: 502, erreur: 'Réponse vide du modèle.' }
    return { statut: 200, texte }
  }
  return { statut: reponse.status, erreur: data?.error?.message || 'Amont indisponible.' }
}

/** Descend la chaîne : le modèle mort ne fait pas payer un aller-retour client. */
async function relayer(charge, cle, maintenant) {
  let derniereErreur = 'aucun modèle disponible'
  let dernierStatut = 503
  let tentatives = 0
  for (const modele of chainePour(charge.model)) {
    if (!disponible(modele, maintenant)) continue
    tentatives += 1
    let resultat
    try {
      resultat = await appelerAmont(charge, modele, cle)
    } catch {
      signaler(modele, maintenant, true)
      derniereErreur = 'Amont injoignable ou trop lent.'
      dernierStatut = 504
      continue
    }
    if (resultat.statut === 200) {
      signaler(modele, maintenant, false)
      return { statut: 200, texte: resultat.texte, modele, tentatives }
    }
    signaler(modele, maintenant, REESSAYABLES.has(resultat.statut))
    dernierStatut = resultat.statut
    derniereErreur = resultat.erreur
    if (!REESSAYABLES.has(resultat.statut)) break
  }
  return { erreur: derniereErreur, statut: dernierStatut, tentatives, chaineEpuisee: true }
}

export default {
  async fetch(request, env) {
    const cors = entetesCors(request)
    const chemin = new URL(request.url).pathname
    const maintenant = Date.now()

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method === 'GET' && chemin === '/health') {
      return json({ ok: true, service: 'errata-proxy-worker', disjoncteur: etatDisjoncteur(maintenant) }, 200, cors)
    }
    if (request.method === 'GET' && chemin === '/modeles') {
      return json({ chaine: CHAINE, disjoncteur: etatDisjoncteur(maintenant), amont: AMONT }, 200, cors)
    }
    if (request.method !== 'POST') return json({ erreur: 'Méthode non autorisée.' }, 405, cors)

    const cle = request.headers.get('x-rature-cle') || env.INFERHUB_API_KEY
    if (!cle) return json({ erreur: 'Proxy non configuré : colle ta clé (BYOK).' }, 503, cors)

    const ip = request.headers.get('cf-connecting-ip') || 'inconnu'
    if (!autoriser(empreinte(ip), maintenant)) {
      return json({ erreur: 'Quota du proxy atteint pour cette heure. Réessaie plus tard.', quota: 'proxy' }, 429, cors)
    }

    const brut = await request.text()
    if (brut.length > TAILLE_MAX) return json({ erreur: 'Photo trop lourde.' }, 413, cors)

    let charge
    try {
      charge = JSON.parse(brut)
    } catch {
      return json({ erreur: 'Corps JSON invalide.' }, 400, cors)
    }
    // Ce proxy ne parle pas SSE : sans retrait du champ, l'amont répondrait en
    // event-stream et ce Worker rendrait du JSON illisible.
    delete charge.stream

    const debut = Date.now()
    const resultat = await relayer(charge, cle, maintenant)
    if (resultat.statut === 200) {
      console.info(`${new Date().toISOString()} 200 ${Date.now() - debut}ms`)
      return json({ texte: resultat.texte, modele: resultat.modele, tentatives: resultat.tentatives }, 200, cors)
    }
    console.info(`${new Date().toISOString()} ${resultat.statut} ${Date.now() - debut}ms`)
    return json(
      { erreur: resultat.erreur, chaineEpuisee: true, tentatives: resultat.tentatives },
      resultat.statut,
      cors,
    )
  },
}

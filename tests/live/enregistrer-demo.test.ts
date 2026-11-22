/**
 * Enregistreur du corpus de démo — capte les vraies réponses du modèle sur
 * plusieurs copies du corpus et les écrit dans `corpus/reponses/`.
 *
 * Pourquoi : la démo publique n'a pas de clé, et l'amont peut être lent ou sans
 * capacité le jour du jugement. Le produit rejoue ces réponses — c'est le
 * « cache des réponses sur le corpus de démo » prévu au tableau des risques
 * (§24). Tout est rejoué **brut** : les parseurs zod travaillent pour de vrai.
 *
 * Trois copies sont enregistrées pour que TOUTES les fonctions du produit soient
 * visibles hors ligne : deux types d'erreur différents (profil + trajectoire) et
 * une copie puissances (mode prof, statistique de classe).
 *
 * Ignoré sans clé. Lancement :
 *   INFERHUB_API_KEY=… npx vitest run tests/live/enregistrer-demo.test.ts
 *
 * ⚠ Toute modification de la structure des appels (fusion, seconde passe,
 * garde-fou) impose de **recapturer** ce corpus : sinon la démo rejoue un ancien
 * format et le parseur renvoie tout en E99 (bug du 11/11, voir tests/demo.test.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { construireDiagnostic } from '../../src/domain/diagnostic'
import { MODELE_PAR_DEFAUT } from '../../src/domain/config'
import { analyserImage } from '../../src/pipeline/analyse'
import type { ClientBrut } from '../../src/pipeline/client'
import { genererExerciceVerifie } from '../../src/pipeline/exercise'
import { revoirFautesPeuSures } from '../../src/pipeline/revue'
import type { RequeteLLM, Transport } from '../../src/pipeline/llm'
import { chaineModeles, construireCorps } from '../../src/pipeline/llm'

const CLE = process.env.INFERHUB_API_KEY ?? ''
const AMONT = process.env.RATURE_AMONT ?? 'https://api.inferhub.dev/v1'
/**
 * Mode proxy : la clé vit côté Worker (jamais ici). On passe alors par le
 * proxy edge, qui descend lui-même la chaîne de modèles. Sans clé et sans
 * proxy, l'enregistreur ne s'exécute pas.
 */
const PROXY = process.env.RATURE_PROXY_URL ?? ''
const MODE_PROXY = PROXY !== '' && CLE === ''
const DELAI_MS = 240_000
const transport: Transport = MODE_PROXY
  ? { proxy: PROXY }
  : { proxy: `${AMONT}/chat/completions` }

/**
 * Copies enregistrées pour la démo : elles sont lues dans `corpus/demo/` (les
 * « photos » de l'élève), et chacune donne un fichier de réponses de même nom.
 */
const DOSSIER_DEMO = '../../corpus/demo'
/** Toutes les copies photo de la démo (cf. corpus/copies-demo.json). */
const TOUTES_COPIES = [
  'copie-demo-1.jpg',
  'copie-demo-2.jpg',
  'copie-demo-3.jpg',
  'copie-demo-4.jpg',
  'copie-demo-5.jpg',
  'copie-demo-6.jpg',
  'v2-copie-1.jpg',
  'v2-copie-2.jpg',
  'v2-copie-3.jpg',
  'v2-copie-4.jpg',
]
/** Sous-ensemble à enregistrer : `RECORD_COPIES=v2-copie-1,v2-copie-2`. */
const COPIES_DEMO = process.env.RECORD_COPIES
  ? TOUTES_COPIES.filter((nom) =>
      process.env.RECORD_COPIES!.split(',')
        .map((entree) => entree.trim().replace(/\.(png|jpg)$/, ''))
        .includes(nom.replace(/\.(png|jpg)$/, '')),
    )
  : TOUTES_COPIES

async function appeler(requete: RequeteLLM, modele: string): Promise<string> {
  const reponse = await fetch(`${AMONT}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${CLE}` },
    body: JSON.stringify(construireCorps(requete, modele)),
    signal: AbortSignal.timeout(DELAI_MS),
  })
  if (!reponse.ok) {
    throw Object.assign(new Error(`amont HTTP ${reponse.status}`), { statut: reponse.status })
  }
  const data = (await reponse.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

/** Un appel au proxy edge : la clé reste côté serveur. */
async function appelerProxy(requete: RequeteLLM, modele: string): Promise<{ texte: string; modele: string }> {
  const reponse = await fetch(PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://gaiasg94.github.io' },
    body: JSON.stringify(construireCorps(requete, modele)),
    signal: AbortSignal.timeout(DELAI_MS),
  })
  const data = (await reponse.json()) as { texte?: string; modele?: string; erreur?: string }
  if (!reponse.ok) {
    throw Object.assign(new Error(data.erreur ?? `proxy HTTP ${reponse.status}`), {
      statut: reponse.status,
    })
  }
  return { texte: data.texte ?? '', modele: data.modele ?? modele }
}

const TRANSITOIRES = new Set([402, 429, 500, 502, 503, 504])
const ESSAIS_PROXY = 6
const PAUSE_PROXY_MS = 12_000
/**
 * Modèles essayés à tour de rôle quand le proxy est utilisé : un modèle peut
 * répondre hors JSON (réponse refusée par le parseur zod). Tourner la liste
 * évite de bloquer sur un modèle bavard.
 */
const MODELES_TENTATION = [
  'ag/gemini-4-carbon',
  'ag/claude-sonnet-4-6',
  'ag/gemini-4-argon',
  'ag/claude-sonnet-5-5',
]

/** Une réponse JSON est attendue : sans accolade, le parseur la refusera. */
function estJson(texte: string): boolean {
  return texte.includes('{') && texte.includes('}')
}

/** Client réel avec repli sur la chaîne, qui enregistre chaque réponse brute. */
function clientEnregistreur(brut: Record<string, string>, cle: string): ClientBrut {
  if (MODE_PROXY) {
    // Le proxy descend déjà la chaîne : on réessaie le proxy entier, avec une
    // pause (un modèle mort est marqué 60 s par le Worker). La dernière bonne
    // réponse écrase les précédentes : une réponse hors JSON ne reste pas.
    return async (requete: RequeteLLM) => {
      let derniere = 'proxy indisponible'
      for (let essai = 0; essai < ESSAIS_PROXY; essai += 1) {
        const modele = MODELES_TENTATION[essai % MODELES_TENTATION.length]!
        try {
          const { texte, modele: repondant } = await appelerProxy(requete, modele)
          if (!estJson(texte)) throw new Error(`réponse hors JSON (${repondant})`)
          brut[cle] = texte
          modelesRepondus.add(repondant)
          return texte
        } catch (erreur) {
          derniere = (erreur as Error).message
          const statut = (erreur as { statut?: number }).statut ?? 0
          if (!TRANSITOIRES.has(statut) && !(erreur as Error).message.includes('hors JSON')) throw erreur
          await new Promise((r) => setTimeout(r, PAUSE_PROXY_MS))
        }
      }
      throw new Error(derniere)
    }
  }
  return async (requete: RequeteLLM) => {
    let derniere = 'aucun modèle disponible'
    for (const modele of chaineModeles(transport)) {
      try {
        const texte = await appeler(requete, modele)
        brut[cle] = texte
        modelesRepondus.add(modele)
        return texte
      } catch (erreur) {
        if (!TRANSITOIRES.has((erreur as { statut?: number }).statut ?? 0)) throw erreur
        derniere = (erreur as Error).message
      }
    }
    throw new Error(derniere)
  }
}

/** Une étape, rejouée jusqu'à 5 fois : une réponse hors JSON ou un 503 ne tue pas l'enregistrement. */
async function avecReprise<T>(nom: string, travail: () => Promise<T>): Promise<T> {
  let derniere: Error | null = null
  for (let essai = 0; essai < 5; essai += 1) {
    try {
      return await travail()
    } catch (erreur) {
      derniere = erreur instanceof Error ? erreur : new Error(String(erreur))
      console.info(`[démo] ${nom} : tentative ${essai + 1} échouée (${derniere.message}), reprise…`)
      await new Promise((r) => setTimeout(r, PAUSE_PROXY_MS))
    }
  }
  throw derniere ?? new Error('échec sans message')
}

/** Les modèles qui ont réellement répondu pendant l'enregistrement. */
const modelesRepondus = new Set<string>()


function imageDataUrl(nom: string): string {
  const chemin = fileURLToPath(new URL(`${DOSSIER_DEMO}/${nom}`, import.meta.url))
  const octets = readFileSync(chemin)
  const type = nom.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
  return `data:${type};base64,${octets.toString('base64')}`
}

function cheminSortie(nom: string): string {
  const base = nom.replace(/\.(png|jpg)$/, '.json')
  return fileURLToPath(new URL(`../../corpus/reponses/${base}`, import.meta.url))
}

/** Enchaîne le chemin réel du produit sur une copie et écrit les réponses. */
async function enregistrer(nom: string) {
  const brut: Record<string, string> = {}
  // Les durées réelles de chaque étape sont capturées : la démo rejouera ce
  // rythme-là, au lieu d'être instantanée (et donc invraisemblable).
  const durees: Record<string, number> = {}
  const chrono = async <T>(etape: string, nom: string, travail: () => Promise<T>): Promise<T> => {
    const debut = Date.now()
    const resultat = await avecReprise(nom, travail)
    durees[etape] = Date.now() - debut
    return resultat
  }
  const { extraction, erreurs } = await chrono('extrait', nom, () =>
    analyserImage(imageDataUrl(nom), transport, clientEnregistreur(brut, 'analyse')),
  )
  const revue = await chrono('classifie', nom, () =>
    revoirFautesPeuSures(erreurs, transport, clientEnregistreur(brut, 'revue')),
  )
  const diagnostic = construireDiagnostic(revue.erreurs, { id: nom, createdAt: new Date().toISOString() })
  // Une copie sans faute n'a pas de type dominant : c'est un résultat
  // attendu (« aucune erreur détectée »), pas un échec d'enregistrement.
  const propre = extraction.copiePropre
  if (!propre) expect(diagnostic.typeDominant, `${nom} : aucun type dominant`).toBeTruthy()

  if (!propre) {
    await chrono('genere', nom, () =>
      genererExerciceVerifie({
        typeDominant: diagnostic.typeDominant!,
        extraitCopie: extraction.annotations.map((a) => a.ligne).slice(0, 6).join('\n'),
        transport,
        client: async (requete: RequeteLLM) => {
          // Le marqueur doit suivre le prompt courant (« Relevance guardrail »),
          // comme dans `etapeDe` de src/pipeline/demo.ts.
          const cle = requete.system.includes('Relevance guardrail') ? 'verdict' : 'exercice'
          return clientEnregistreur(brut, cle)(requete)
        },
      }),
    )
  }

  mkdirSync(fileURLToPath(new URL('../../corpus/reponses/', import.meta.url)), { recursive: true })
  writeFileSync(
    cheminSortie(nom),
    `${JSON.stringify(
      {
        source: `corpus/demo/${nom}`,
        modele: [...modelesRepondus].join(', ') || MODELE_PAR_DEFAUT,
        enregistreLe: new Date().toISOString(),
        dominant: propre ? 'propre' : diagnostic.typeDominant,
        nbFautes: propre ? 0 : diagnostic.nbFautes,
        revues: revue.revues,
        durees,
        reponses: brut,
      },
      null,
      2,
    )}\n`,
  )
  return { nom, dominant: propre ? 'propre' : diagnostic.typeDominant, revues: revue.revues }
}

describe.skipIf(!CLE && !MODE_PROXY)('enregistrement du corpus de démo', () => {
  for (const nom of COPIES_DEMO) {
    it(
      `capte analyse, revue, exercice et verdict sur ${nom}`,
      async () => {
        const resultat = await enregistrer(nom)
        console.info(`[démo] ${resultat.nom} → dominant ${resultat.dominant}, revues ${resultat.revues}`)
        const contenu = JSON.parse(readFileSync(cheminSortie(nom), 'utf8')) as {
          dominant: string
          reponses: Record<string, string>
        }
        expect(contenu.reponses.analyse).toBeTruthy()
        // Une copie propre n'a ni exercice ni verdict : le pipeline s'arrête
        // avant, et c'est le résultat attendu (« aucune erreur détectée »).
        if (contenu.dominant === 'propre') {
          expect(contenu.reponses.exercice).toBeUndefined()
          return
        }
        expect(contenu.reponses.exercice).toBeTruthy()
        expect(contenu.reponses.verdict).toBeTruthy()
      },
      DELAI_MS * 8,
    )
  }
})
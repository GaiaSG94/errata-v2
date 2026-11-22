/**
 * Mode démonstration — rejoue des réponses **réellement enregistrées** par le
 * modèle sur les copies du corpus (`corpus/reponses/*.json`, captées par
 * `tests/live/enregistrer-demo.test.ts`).
 *
 * À quoi ça sert : la démo publique n'a pas de clé, et l'amont peut être lent ou
 * sans capacité le jour du jugement. Tout le produit reste démontrable hors
 * ligne — y compris le mode professeur et la trajectoire du profil, qui demandent
 * plusieurs copies. Les parseurs zod travaillent sur du vrai JSON de modèle,
 * rien n'est court-circuité.
 *
 * Les copies disponibles sont découvertes au build (`import.meta.glob`) : ajouter
 * un enregistrement dans `corpus/reponses/` étend la démo sans toucher au code.
 *
 * Honnêteté : l'UI affiche « réponses enregistrées » quand ce mode tourne.
 */
import { libelleDe } from '../domain/taxonomy'
import type { CodeErreur } from '../domain/taxonomy'
import type { ClientBrut } from './client'
import type { RequeteLLM } from './llm'
import descriptionDemo from '../../corpus/copies-demo.json'

export type EtapeDemo = 'analyse' | 'revue' | 'exercice' | 'verdict'

type Enregistrement = {
  source: string
  modele: string
  enregistreLe: string
  dominant: string
  /** Absent des enregistrements antérieurs au 12/11 : toléré. */
  nbFautes?: number
  revues?: number
  /** Durées réelles mesurées lors de l'enregistrement, rejouées par la démo. */
  durees?: Record<string, number>
  reponses: Record<string, string>
}

export type CopieDemo = {
  id: string
  titre: string
  image: string
  enregistrement: Enregistrement
}

/**
 * Un échantillon : une copie photo que le jury peut tester. Elle n'a pas
 * forcément de réponses enregistrées — sans elles, l'analyse passe par le
 * modèle en ligne (le proxy edge), avec elles elle rejoue hors ligne.
 */
export type Echantillon = {
  id: string
  image: string
  eleve: string
  classe: string
  devoir: string
  titre: string
  resume: string
  note: string
  typesAttendus: string[]
  /** Réponses enregistrées sur CETTE photo : absent = analyse en ligne. */
  enregistrement: Enregistrement | null
}

/**
 * `eager` + `import: 'default'` : sans l'option `import`, Vite rend le MODULE
 * (objet) et non la valeur — en dev, `fetch(module)` lève « Cannot convert
 * object to primitive value ». Bug payé le 12/11.
 */
const REPONSES = import.meta.glob<Enregistrement>('../../corpus/reponses/*.json', {
  eager: true,
  import: 'default',
})
const IMAGES = import.meta.glob<string>('../../corpus/demo/*.{png,jpg}', { eager: true, import: 'default' })

/** Titre lisible : le type dominant, et le nombre de fautes quand il est connu. */
function titreCopie(id: string, enregistrement: Enregistrement): string {
  const libelle = libelleDe(enregistrement.dominant as CodeErreur)
  const fautes = enregistrement.nbFautes
  if (enregistrement.dominant === 'propre') return `${id} — aucune erreur détectée`
  return fautes === undefined ? `${id} — ${libelle}` : `${libelle} — ${fautes} mistake(s)`
}

/**
 * Les échantillons : toutes les copies décrites dans `corpus/copies-demo.json`
 * pour lesquelles une photo existe. C'est la source de vérité unique — la même
 * que celle qui a produit les photos et les réponses enregistrées.
 */
function construireEchantillons(): Echantillon[] {
  const echantillons: Echantillon[] = []
  for (const copie of descriptionDemo.copies) {
    const image = IMAGES[`../../corpus/demo/${copie.id}.jpg`] ?? IMAGES[`../../corpus/demo/${copie.id}.png`]
    if (!image) continue
    echantillons.push({
      id: copie.id,
      image,
      eleve: copie.eleve,
      classe: copie.classe,
      devoir: copie.devoir,
      titre: copie.titre,
      resume: copie.resume ?? '',
      note: copie.note ?? '',
      typesAttendus: copie.types_attendus ?? [],
      enregistrement: REPONSES[`../../corpus/reponses/${copie.id}.json`] ?? null,
    })
  }
  return echantillons
}

export const COPIES_ECHANTILLON: Echantillon[] = construireEchantillons()

/** Un échantillon par son identifiant. */
export function echantillonDe(id: string): Echantillon | undefined {
  return COPIES_ECHANTILLON.find((e) => e.id === id)
}

/**
 * Titre de carte de l'écran « Sample papers » : « Jordan · Test 3 — Algebra &
 * derivatives ». L'élève d'abord, puis le contrôle, puis le titre du contrôle ;
 * la date reste dans le manifeste, elle n'occupe pas la carte.
 */
export function titreCarte(echantillon: Echantillon): string {
  const eleve = echantillon.eleve.split(' ')[0] ?? echantillon.eleve
  const devoir = echantillon.devoir.split(' · ')[0] ?? echantillon.devoir
  return `${eleve} · ${devoir} — ${echantillon.titre}`
}

function estEnregistre(e: Echantillon): e is Echantillon & { enregistrement: Enregistrement } {
  return e.enregistrement !== null
}

/** Les copies **rejouables** hors ligne : celles dont les réponses sont capturées. */
export const COPIES_DEMO: CopieDemo[] = COPIES_ECHANTILLON.filter(estEnregistre).map((e) => ({
  id: e.id,
  titre: titreCopie(e.id, e.enregistrement),
  image: e.image,
  enregistrement: e.enregistrement,
}))

export const ID_COPIES_DEMO = COPIES_DEMO.map((copie) => copie.id)

/**
 * Le tour guidé de l'accueil : la trajectoire de Jordan (mauvaise récurrente
 * E01 sur trois copies, puis une copie propre). C'est la même histoire que
 * celle montrée sur l'écran « Sample papers » — le juge voit les deux.
 * Si un enregistrement manque, la copie est simplement sautée.
 */
export const TOUR_DEMO = ['v2-copie-1', 'v2-copie-2', 'v2-copie-3', 'v2-copie-4'].filter((id) =>
  ID_COPIES_DEMO.includes(id),
)

export function copieDemo(id?: string): CopieDemo | undefined {
  if (!id) return COPIES_DEMO[0]
  return COPIES_DEMO.find((copie) => copie.id === id)
}

/** Quelle étape le prompt en cours correspond-il ? (marqueurs de titres) */
export function etapeDe(requete: RequeteLLM): EtapeDemo {
  const system = requete.system
  if (system.includes('Relevance guardrail')) return 'verdict'
  if (system.includes('Generating a targeted exercise')) return 'exercice'
  if (system.includes('Second pass')) return 'revue'
  return 'analyse'
}

/** Pause courte : la démo rejoue le rythme réel de l'enregistrement. */
function attendre(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms))
}

/**
 * Client de rejeu pour une copie donnée. Deux rythmes :
 * - `attenteMax` absent : on **attend la durée réellement mesurée** lors de
 *   l'enregistrement — sans cela, la démo serait instantanée et donc peu
 *   crédible (« 0,1 s » pour une analyse complète est un signal d'alerte
 *   pour un juge technique) ;
 * - `attenteMax` fourni (tour guidé multi-copies) : la même réponse, le même
 *   ordre, mais un plafond par étape pour que quatre copies tiennent en
 *   quelques dizaines de secondes. L'UI dit honnêtement « accéléré ».
 */
export function clientDemoPour(
  id?: string,
  options: { attente?: boolean; attenteMax?: number } = {},
): ClientBrut {
  const copie = copieDemo(id)
  if (!copie) throw new Error('Demo mode: no recorded answer in corpus/reponses/.')
  const reponses = copie.enregistrement.reponses
  const durees = copie.enregistrement.durees ?? {}
  const attendu = options.attente ?? true
  const attenteMax = options.attenteMax ?? Number.POSITIVE_INFINITY
  return async (requete: RequeteLLM) => {
    const etape = etapeDe(requete)
    const texte = reponses[etape]
    if (!texte) {
      throw new Error(
        `Demo mode: no recorded answer for step "${etape}" — recapture the corpus.`,
      )
    }
    // Les durées sont enregistrées par ÉTAPE du pipeline (extrait, classifie,
    // genere), alors que l'appel est identifié par son prompt. Correspondance :
    const etapePipeline = {
      analyse: 'extrait',
      revue: 'classifie',
      exercice: 'genere',
      verdict: 'genere',
    }[etape]
    const duree = durees[etapePipeline]
    if (attendu && typeof duree === 'number' && duree > 0 && duree < 60_000) {
      await attendre(Math.min(duree, attenteMax))
    }
    return texte
  }
}

export function clientDemo(): ClientBrut {
  return clientDemoPour()
}

/** Métadonnées de l'enregistrement, affichées dans l'UI. */
export function origineDemo(id?: string) {
  const copie = copieDemo(id)
  if (!copie) return null
  return {
    titre: copie.titre,
    modele: copie.enregistrement.modele,
    enregistreLe: copie.enregistrement.enregistreLe,
    dominant: copie.enregistrement.dominant,
    nbFautes: copie.enregistrement.nbFautes ?? null,
    revues: copie.enregistrement.revues ?? 0,
  }
}

/** Une copie de démo, en `File` : le pipeline tourne exactement comme en vrai. */
export async function fichierDemoPour(id?: string): Promise<File> {
  const copie = copieDemo(id)
  if (!copie) throw new Error('Demo mode: no recorded paper available.')
  const reponse = await fetch(copie.image)
  const blob = await reponse.blob()
  return new File([blob], `${copie.id}.png`, { type: blob.type || 'image/png' })
}

/**
 * Un échantillon, en `File` — enregistré ou non. Le jury teste ainsi une
 * vraie photo : le pipeline la traite exactement comme une photo prise au
 * téléphone.
 */
export async function fichierEchantillon(id: string): Promise<File> {
  const echantillon = echantillonDe(id)
  if (!echantillon) throw new Error(`Sample paper not found: ${id}`)
  const reponse = await fetch(echantillon.image)
  const blob = await reponse.blob()
  return new File([blob], `${echantillon.id}.jpg`, { type: blob.type || 'image/jpeg' })
}

export async function fichierDemo(): Promise<File> {
  return fichierDemoPour()
}

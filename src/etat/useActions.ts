/**
 * Actions de l'application. Toute analyse passe par `executerAnalyse` : le mode
 * démo n'est qu'un client différent (`clientDemoPour`), jamais un chemin
 * parallèle — c'est ce qui garantit que la démo montre le vrai pipeline.
 */
import type { Dispatch, SetStateAction } from 'react'
import { useCallback } from 'react'
import type { Diagnostic, ResultatAnalyse } from '../domain/types'
import { clientDemoPour, echantillonDe, fichierEchantillon, fichierDemoPour } from '../pipeline/demo'
import { ID_COPIES_DEMO } from '../pipeline/demo'
import { obtenirExercice } from '../pipeline/exercise'
import { analyserCopie } from '../pipeline/orchestrate'
import type { Transport } from '../pipeline/llm'
import { enregistrerDiagnostic, effacerHistorique, sauverReglages } from '../storage/local'
import type { Etat, Modificateur } from './useEtatRature'
import type { Ecran } from './useEtatRature'
import { amontMort, fusionner, messageErreur, transportDe } from './useEtatRature'
import type { Reglages } from '../domain/types'

const ATTENTE_DEMO_GUIDEE_MS = 850
/** Délai max d'une analyse avant de rendre la main avec un message honnête. */
const DELAI_ANALYSE_MAX_MS = 150_000

export type { Reglages }

type Ctx = { etat: Etat; setEtat: Dispatch<SetStateAction<Etat>>; aller: (ecran: Ecran) => void }

/** Transport commun à tous les appels : chaîne optimisée + modèle répondu. */
function transportPour({ etat, setEtat }: Ctx) {
  return transportDe(etat.reglages, {
    chaine: etat.chaineModeles,
    surModele: (modele) => setEtat((precedent) => ({ ...precedent, modeleRepondu: modele })),
    surProgres: (message) => setEtat((precedent) => ({ ...precedent, messageProgres: message })),
  })
}

/** Une analyse, avec publication de la progression. Rend null si échec. */
async function executerAnalyse(
  fichier: File,
  options: { transport: Transport; demoId?: string; attenteMax?: number; setEtat: Ctx['setEtat'] },
): Promise<ResultatAnalyse | null> {
  const { demoId, setEtat } = options
  try {
    return await analyserCopie(fichier, {
      transport: options.transport,
      ...(demoId ? { client: clientDemoPour(demoId, { attenteMax: options.attenteMax }) } : {}),
      onProgression: (p) => setEtat((precedent) => ({ ...precedent, progression: fusionner(precedent.progression, p) })),
    })
  } catch (erreur) {
    setEtat((precedent) => ({
      ...precedent,
      erreur: messageErreur(erreur),
      ...(amontMort(erreur) ? { santeProxy: 'ko' as const } : {}),
    }))
    return null
  }
}

/** Affiche le diagnostic dès la fin de l'étape 5, puis persiste en arrière-plan. */
/**
 * Affiche le diagnostic dès la fin de l'étape 5 — sauf si l'utilisateur a
 * quitté l'écran Analyse (mode asynchrone, idée 8) : dans ce cas on ne le
 * rapatrie pas de force, on allume un badge « diagnostic prêt ».
 */
function publierPartiel(
  setEtat: Ctx['setEtat'],
  partiel: ResultatAnalyse,
  demoId: string | null,
): void {
  setEtat((precedent) => ({
    ...precedent,
    occupe: false,
    resultat: partiel,
    demoId,
    ecran: precedent.ecran === 'analyse' ? 'diagnostic' : precedent.ecran,
    diagnosticPret: precedent.ecran !== 'analyse' && precedent.ecran !== 'diagnostic',
  }))
  void enregistrerDiagnostic(partiel.diagnostic).then((profil) => {
    setEtat((precedent) => ({
      ...precedent,
      profil,
      diagnostics: [...precedent.diagnostics, partiel.diagnostic],
    }))
  })
}

export function useActionsRature({ etat, setEtat, aller }: Ctx) {
  const analyser = useCallback(
    async (fichier: File, options: { demoId?: string; attenteMax?: number } = {}) => {
      aller('analyse')
      setEtat((precedent) => ({
        ...precedent,
        occupe: true,
        erreur: null,
        progression: [],
        demoId: null,
        dernierFichier: fichier,
      }))
      const demoId = options.demoId ?? null
      // Délai max, honnête : au-delà, on rend la main avec un message clair au
      // lieu de laisser l'écran bloqué sur une étape « en cours » pendant
      // plusieurs minutes (bug du 15/11 devant un juge).
      let vidange: ReturnType<typeof setTimeout> | undefined
      const delaiMax = new Promise<null>((resoudre) => {
        vidange = setTimeout(() => resoudre(null), DELAI_ANALYSE_MAX_MS)
      })
      const course = analyserCopie(fichier, {
        transport: transportPour({ etat, setEtat, aller }),
        ...(demoId ? { client: clientDemoPour(demoId, { attenteMax: options.attenteMax }) } : {}),
        onProgression: (p) =>
          setEtat((precedent) => ({ ...precedent, progression: fusionner(precedent.progression, p) })),
        onResultatPartiel: (partiel) => publierPartiel(setEtat, partiel, demoId),
      }).catch((erreur: unknown) => {
        setEtat((precedent) => ({
          ...precedent,
          occupe: false,
          erreur: messageErreur(erreur),
          ...(amontMort(erreur) ? { santeProxy: 'ko' as const } : {}),
        }))
        return null
      })
      const resultat = await Promise.race([course, delaiMax]).finally(() => clearTimeout(vidange))
      if (resultat) {
        setEtat((precedent) => ({ ...precedent, occupe: false, resultat, demoId }))
        return
      }
      // Le watchdog a gagné (la course n'a rien renvoyé ni échoué) : on rend
      // la main. L'analyse continue en arrière-plan : si elle aboutit, le
      // badge « diagnosis ready » s'allumera quand même (idée 8).
      setEtat((precedent) => ({
        ...precedent,
        occupe: false,
        erreur: `The model is taking too long (over ${Math.round(DELAI_ANALYSE_MAX_MS / 1000)}s). Try again — or run the offline demo below.`,
      }))
    },
    [aller, etat.reglages, setEtat],
  )

  /** Démo : une copie seule (rythme réel), ou plusieurs d'affilée (tour guidé : trajectoire du profil, rythme accéléré). */
  const analyserDemo = useCallback(
    async (ids?: string[]) => {
      const cibles = ids && ids.length > 0 ? ids : ID_COPIES_DEMO.slice(0, 1)
      const guide = cibles.length > 1
      for (const id of cibles) {
        await analyser(await fichierDemoPour(id), {
          demoId: id,
          ...(guide ? { attenteMax: ATTENTE_DEMO_GUIDEE_MS } : {}),
        })
      }
      // Plusieurs copies : c'est la trajectoire qui intéresse, pas la dernière copie.
      if (guide) aller('profil')
    },
    [analyser, aller],
  )

  /**
   * Un échantillon joué par le jury : une photo de copie réelle. Si les
   * réponses du modèle sont enregistrées sur CETTE photo, on rejoue hors
   * ligne ; sinon l'analyse part en ligne vers le proxy edge.
   */
  const analyserEchantillon = useCallback(
    async (id: string) => {
      const echantillon = echantillonDe(id)
      if (!echantillon) {
        setEtat((precedent) => ({ ...precedent, erreur: `Sample paper not found: ${id}` }))
        return
      }
      const demoId = echantillon.enregistrement ? id : undefined
      await analyser(await fichierEchantillon(id), demoId ? { demoId } : {})
    },
    [analyser, setEtat],
  )

  /**
   * Mode prof : les copies analysées ici ne rejoignent PAS l'historique
   * personnel — le profil d'un élève et la statistique d'une classe ne se
   * mélangent pas.
   */
  const analyserLot = useCallback(
    async (fichiers: File[], demoIds?: string[]) => {
      const collectes: Diagnostic[] = []
      setEtat((precedent) => ({ ...precedent, occupe: true, erreur: null, progression: [] }))
      for (const [index, fichier] of fichiers.entries()) {
        const resultat = await executerAnalyse(fichier, {
          transport: transportPour({ etat, setEtat, aller }),
          ...(demoIds?.[index] ? { demoId: demoIds[index] } : {}),
          setEtat,
        })
        if (resultat) collectes.push(resultat.diagnostic)
      }
      setEtat((precedent) => ({ ...precedent, occupe: false, demoId: demoIds ? 'lot' : null }))
      return collectes
    },
    [etat.reglages, setEtat],
  )

  /** Mode prof hors ligne : le lot de démonstration, réponses enregistrées. */
  const analyserLotDemo = useCallback(async () => {
    const fichiers: File[] = []
    for (const id of ID_COPIES_DEMO) fichiers.push(await fichierDemoPour(id))
    return analyserLot(fichiers, ID_COPIES_DEMO)
  }, [analyserLot])

  const enregistrerReglages = useCallback(
    async (reglages: Reglages) => {
      await sauverReglages(reglages)
      setEtat((precedent) => ({ ...precedent, reglages }))
    },
    [setEtat],
  )

  const viderHistorique = useCallback(async () => {
    await effacerHistorique()
    setEtat((precedent) => ({
      ...precedent,
      diagnostics: [],
      profil: precedent.profil && { ...precedent.profil, parType: precedent.profil.parType, totalAnalyses: 0, evolution: [], signalees: {} },
      resultat: null,
    }))
  }, [setEtat])

  const reinitialiserErreur = useCallback(() => {
    setEtat((precedent) => ({ ...precedent, erreur: null }))
  }, [setEtat])

  /**
   * Un autre exercice. Par défaut : **banque locale**, donc aucun appel réseau
   * (idée 1). `inedit: true` demande au modèle un exercice inédit — deux
   * appels, donc 30 à 110 s sur l'amont : c'est un choix, pas un défaut.
   */
  const nouvelExercice = useCallback(
    async (options: { inedit?: boolean } = {}) => {
      const resultat = etat.resultat
      const type = resultat?.diagnostic.typeDominant
      if (!resultat || !type) return
      setEtat((precedent) => ({ ...precedent, occupe: true }))
      try {
        const extrait = resultat.extraction.annotations.map((a) => a.ligne).slice(0, 6).join('\n')
        const obtenu = await obtenirExercice({
          typeDominant: type,
          extraitCopie: extrait,
          transport: transportPour({ etat, setEtat, aller }),
          inedit: options.inedit ?? false,
          dejaVus: etat.exercicesVus,
          graine: Date.now() % 1000,
          ...(etat.demoId ? { client: clientDemoPour(etat.demoId) } : {}),
        })
        setEtat((precedent) => ({
          ...precedent,
          occupe: false,
          exercicesVus: obtenu.exercice?.exercice.id
            ? [...precedent.exercicesVus, obtenu.exercice.exercice.id]
            : precedent.exercicesVus,
          resultat: precedent.resultat
            ? {
                ...precedent.resultat,
                exercice: obtenu.exercice,
                ...(obtenu.message ? { messageExercice: obtenu.message } : {}),
              }
            : precedent.resultat,
        }))
      } catch (erreur) {
        setEtat((precedent) => ({ ...precedent, occupe: false, erreur: messageErreur(erreur) }))
      }
    },
    [etat.resultat, etat.reglages, etat.demoId, etat.exercicesVus, setEtat, aller],
  )

  /** Reprise après un échec : la même photo, sans re-choisir le fichier. */
  const reprendreAnalyse = useCallback(async () => {
    const fichier = etat.dernierFichier
    if (!fichier) return
    await analyser(fichier)
  }, [analyser, etat.dernierFichier])

  return {
    analyser,
    analyserDemo,
    analyserEchantillon,
    analyserLot,
    analyserLotDemo,
    enregistrerReglages,
    viderHistorique,
    reinitialiserErreur,
    nouvelExercice,
    reprendreAnalyse,
  }
}

export type ModificateurEtat = Modificateur

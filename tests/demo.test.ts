import { describe, expect, it } from 'vitest'
import { construireDiagnostic } from '../src/domain/diagnostic'
import { PROMPT_ANALYSE, decouperAnalyse } from '../src/pipeline/analyse'
import {
  COPIES_DEMO,
  ID_COPIES_DEMO,
  TOUR_DEMO,
  clientDemoPour,
  copieDemo,
  etapeDe,
  echantillonDe,
  origineDemo,
  titreCarte,
} from '../src/pipeline/demo'
import { PROMPT_GARDE_FOU, PROMPT_GENERATION, verdictAccepte } from '../src/pipeline/exercise'
import { PROMPT_REVUE } from '../src/pipeline/revue'
import { parserAnalyse, parserExercice, parserVerdict } from '../src/pipeline/schemas'

/**
 * Le mode démo rejoue de vraies réponses de modèle. Ces tests vérifient que
 * chaque enregistrement est toujours exploitable **sur le chemin courant du
 * produit** : une évolution du pipeline (fusion d'appels, seconde passe) casse
 * la démo en silence si on ne recapture pas — c'est arrivé le 11/11, tout
 * retombait en E99. Le test échoue désormais dans ce cas.
 */
describe('mode démonstration', () => {
  it('reconnaît l’étape à partir du prompt', () => {
    const requete = (system: string) => ({ system, user: 'x' })
    expect(etapeDe(requete(PROMPT_ANALYSE))).toBe('analyse')
    expect(etapeDe(requete(PROMPT_REVUE))).toBe('revue')
    expect(etapeDe(requete(PROMPT_GENERATION))).toBe('exercice')
    expect(etapeDe(requete(PROMPT_GARDE_FOU))).toBe('verdict')
  })

  it('au moins une copie est enregistrée, avec un identifiant stable', () => {
    expect(COPIES_DEMO.length).toBeGreaterThanOrEqual(1)
    expect(ID_COPIES_DEMO).toHaveLength(COPIES_DEMO.length)
    expect(copieDemo(ID_COPIES_DEMO[0])?.id).toBe(ID_COPIES_DEMO[0])
    expect(copieDemo('inexistant')).toBeUndefined()
    expect(copieDemo()).toBeDefined()
  })

  it.each(ID_COPIES_DEMO)('la copie %s se rejoue en un diagnostic typé', async (id) => {
    const client = clientDemoPour(id, { attente: false })
    const meta = origineDemo(id)
    expect(meta).not.toBeNull()

    const brut = parserAnalyse(await client({ system: PROMPT_ANALYSE, user: 'x' }))
    const { extraction, erreurs } = decouperAnalyse(brut)

    // Une copie « propre » enregistrée : le diagnostic attendu est l'absence
    // de faute (RNF-04), et le pipeline s'arrête avant classification et
    // exercice — il n'y a rien à rejouer ensuite.
    if (meta!.dominant === 'propre') {
      expect(extraction.copiePropre).toBe(true)
      expect(erreurs).toHaveLength(0)
      return
    }

    expect(extraction.copiePropre).toBe(false)
    expect(erreurs.length).toBeGreaterThanOrEqual(1)

    const diagnostic = construireDiagnostic(erreurs, { id, createdAt: '2026-11-12T12:00:00.000Z' })
    // Garde anti-E99 : si tout retombe en « non typée », l'enregistrement est périmé.
    expect(diagnostic.erreurs.some((e) => e.code !== 'E99'), 'toutes les fautes en E99').toBe(true)
    expect(diagnostic.typeDominant).toBe(meta!.dominant)
    if (meta!.nbFautes !== null) expect(diagnostic.nbFautes).toBe(meta!.nbFautes)

    const exercice = parserExercice(await client({ system: PROMPT_GENERATION, user: 'x' }))
    expect(exercice.enonce.length).toBeGreaterThan(10)
    expect(exercice.solution.length).toBeGreaterThan(10)

    const verdict = parserVerdict(await client({ system: PROMPT_GARDE_FOU, user: 'x' }))
    if (!verdictAccepte(verdict)) {
      // Refus assumé : deux tentatives épuisées, le produit ne sert pas un
      // exercice hors sujet et le dit (« exercice non disponible »). Un refus
      // muet, lui, serait un bug — il doit toujours être motivé.
      expect(verdict.motifs.length).toBeGreaterThan(0)
    }
  })

  it('un enregistrement sans réponse de seconde passe lève un message explicite', async () => {
    const copie = COPIES_DEMO.find((c) => !c.enregistrement.reponses.revue)
    if (!copie) return // toutes les copies ont une revue enregistrée : rien à tester
    const client = clientDemoPour(copie.id, { attente: false })
    await expect(client({ system: PROMPT_REVUE, user: 'x' })).rejects.toThrow(/recapture/)
  })
})

/**
 * Corpus de démo v2 (copies du 15/11) : quatre copies du même élève en
 * terminale — la faute de signe qui revient, puis disparaît. Les expectations
 * ci-dessous sont **mesurées** (docs/VALIDATION-MODELE.md) : si une récapture
 * change un résultat, ce test échoue et la documentation doit être mise à jour
 * dans le même commit — pas l'inverse.
 */
describe('corpus de démo v2 — Jordan, Grade 12', () => {
  const ATTENDU: Record<string, string> = {
    'v2-copie-1': 'E01',
    'v2-copie-2': 'E01',
    'v2-copie-3': 'E01',
    'v2-copie-4': 'propre',
  }

  it('les quatre cartes portent les titres annoncés', () => {
    const titres = Object.keys(ATTENDU).map((id) => titreCarte(echantillonDe(id)!))
    expect(titres).toEqual([
      'Jordan · Test 3 — Algebra & derivatives',
      'Jordan · Test 4 — Antiderivatives',
      'Jordan · Test 5 — Definite integrals',
      'Jordan · Quiz — Integration',
    ])
  })

  it.each(Object.entries(ATTENDU))('%s est enregistrée avec le type attendu', (id, dominant) => {
    const copie = copieDemo(id)
    expect(copie, `${id} absente du corpus de démo`).toBeDefined()
    expect(copie!.enregistrement.dominant).toBe(dominant)
  })

  it('la copie 1 détecte aussi E03, la copie propre aucun code', () => {
    const analyse = JSON.parse(copieDemo('v2-copie-1')!.enregistrement.reponses.analyse!) as {
      annotations: { code: string }[]
      copiePropre: boolean
    }
    const codes = analyse.annotations.map((annotation) => annotation.code)
    expect(codes).toContain('E03')
    expect(codes).toContain('E01')
    const propre = JSON.parse(copieDemo('v2-copie-4')!.enregistrement.reponses.analyse!) as {
      annotations: unknown[]
      copiePropre: boolean
    }
    expect(propre.copiePropre).toBe(true)
    expect(propre.annotations).toHaveLength(0)
  })

  it('le tour guidé suit les quatre copies de Jordan', () => {
    expect(TOUR_DEMO).toEqual(['v2-copie-1', 'v2-copie-2', 'v2-copie-3', 'v2-copie-4'])
  })
})

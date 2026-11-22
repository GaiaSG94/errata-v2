/**
 * Adresses publiques du projet. Un seul endroit : les sections qui pointent vers
 * le dépôt ou la démo en découlent, aucune URL n'est recopiée.
 */
export const DEPOT = 'https://github.com/GaiaSG94/errata-v2'

export const DEMO = 'https://gaiasg94.github.io/errata-v2/'

/** Lien GitHub vers un fichier du dépôt, sur la branche principale. */
export function docDuDepot(chemin: string): string {
  return `${DEPOT}/blob/main/${chemin}`
}

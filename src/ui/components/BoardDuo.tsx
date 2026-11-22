import { useEffect, useState } from 'react'

/**
 * Bloc de droite du hero (maquette V9, section A) : deux scènes qui
 * s'enchaînent — C1 « Errata scans your paper » puis C5 « You practise the
 * habit » — avec deux onglets cliquables et une jauge ambre sous l'onglet actif.
 *
 * L'onglet actif pilote tout : un clic saute directement à la scène voulue.
 * `prefers-reduced-motion` : plus d'auto-rotation (le mouvement est coupé
 * globalement dans styles.css), l'onglet reste utilisable au clic.
 */

const DUREE_SCENE_MS = 6500

type Scene = 'scan' | 'habitude'

/** C1 — la copie passe sous le faisceau, les fautes s'encadrent une à une. */
function SceneScan() {
  return (
    <div className="errata-scan">
      <div className="errata-scan-labo">
        <span>Jordan · Test 3 · name hidden</span>
        <span>analysing…</span>
      </div>
      <div className="errata-scan-papier">
        <div className="errata-scan-ligne">f(x) = (2x − 3)² − (x + 1)(x − 1)</div>
        <div className="errata-scan-ligne">f(x) = 4x² − 9 − x² − 1</div>
        <div className="errata-scan-ligne">g′(x) = 6x e<sup>−x</sup> + (3x² − 1) e<sup>−x</sup></div>
        <div className="errata-scan-ligne">h(x) = −2x² − 6x − 2</div>
        <div className="errata-scan-faisceau" />
        <div className="errata-scan-cadre" style={{ left: '18%', top: '1.4rem', width: '7rem', height: '2.1rem', animationDelay: '1s' }}>
          <span className="sticker sticker-ambre">E03</span>
        </div>
        <div className="errata-scan-cadre" style={{ left: '26%', top: '4.3rem', width: '9rem', height: '2.1rem', animationDelay: '1.8s' }}>
          <span className="sticker sticker-ambre">E01</span>
        </div>
        <div className="errata-scan-cadre" style={{ left: '12%', top: '7.2rem', width: '7.5rem', height: '2.1rem', animationDelay: '2.6s' }}>
          <span className="sticker sticker-ambre">E01</span>
        </div>
      </div>
      <div className="errata-scan-etapes">
        {['1 normalize', '2 mask name', '3 read marks', '4 classify', '5 profile', '6 drill'].map(
          (etape, index) => (
            <span key={etape} style={{ animationDelay: `${index * 0.4}s` }}>
              {etape}
            </span>
          ),
        )}
      </div>
    </div>
  )
}

/** C5 — le produit tel que l'élève le vit sur mobile. */
function SceneHabitude() {
  return (
    <div className="errata-tel">
      <div className="errata-tel-appareil">
        <div className="errata-tel-encoche" />
        <div className="errata-tel-carte errata-tel-push">
          <b>Errata · this week</b>
          <small>Your habit: the sign before a bracket.</small>
        </div>
        <div className="errata-tel-carte">
          <span className="sticker sticker-ambre">E01 drill</span>
          <p className="errata-tel-question">Expand −4(x − 3)</p>
          <div className="errata-tel-reponse">
            <span>= −4x + 12</span>
          </div>
          <span className="errata-tel-ok">Got it ✓</span>
        </div>
        <div className="errata-tel-carte" style={{ fontSize: '0.7rem' }}>
          3 papers analysed · nothing stored
        </div>
      </div>
      <ol className="errata-tel-etapes">
        <li>
          <i>1</i>Snap the paper you already got back.
        </li>
        <li>
          <i>2</i>See the one mistake you keep making, with proof from your papers.
        </li>
        <li>
          <i>3</i>Fix it with one short drill, not a whole chapter.
        </li>
      </ol>
    </div>
  )
}

export function BoardDuo() {
  const [scene, setScene] = useState<Scene>('scan')
  const mouvementReduit = useMouvementReduit()

  useEffect(() => {
    if (mouvementReduit) return
    const minuteur = setInterval(
      () => setScene((actuelle) => (actuelle === 'scan' ? 'habitude' : 'scan')),
      DUREE_SCENE_MS,
    )
    return () => clearInterval(minuteur)
  }, [mouvementReduit])

  return (
    <div className="errata-duo" aria-label="How Errata works">
      <div className="errata-duo-onglets" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={scene === 'scan'}
          className={scene === 'scan' ? 'errata-duo-onglet est-actif' : 'errata-duo-onglet'}
          onClick={() => setScene('scan')}
        >
          1 · Errata scans your paper
          <i />
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scene === 'habitude'}
          className={scene === 'habitude' ? 'errata-duo-onglet est-actif' : 'errata-duo-onglet'}
          onClick={() => setScene('habitude')}
        >
          2 · You practise the habit
          <i />
        </button>
      </div>
      <div className={scene === 'scan' ? 'errata-duo-scene est-active' : 'errata-duo-scene'}>
        <SceneScan />
      </div>
      <div className={scene === 'habitude' ? 'errata-duo-scene est-active' : 'errata-duo-scene'}>
        <SceneHabitude />
      </div>
    </div>
  )
}

/** Le mouvement réduit arrête l'auto-rotation : on lit l'état du media query. */
function useMouvementReduit() {
  const [reduit, setReduit] = useState(false)
  useEffect(() => {
    const requete = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduit(requete.matches)
    const ecoute = (evenement: MediaQueryListEvent) => setReduit(evenement.matches)
    requete.addEventListener('change', ecoute)
    return () => requete.removeEventListener('change', ecoute)
  }, [])
  return reduit
}

import { Bouton } from '../components/Bouton'
import { BandeauSante } from '../components/BandeauSante'
import { Carte } from '../components/Carte'
import { BoardDuo } from '../components/BoardDuo'
import { COPIES_DEMO, TOUR_DEMO } from '../../pipeline/demo'
import { useRature } from '../../etat/useRature'

const TITRE = ['Turn', 'your', 'mistakes', 'into', 'moves'] as const

/**
 * Accueil V9 (maquette Design/rature/accueil-v9.html, section A + C) :
 * hero corrigé — trois boutons sur une ligne (ambre / blanc / vert), titre mot
 * à mot avec « moves » en ambre — et bloc de droite = duo C1 (scan live) puis
 * C5 (téléphone). La galerie de copies vit désormais sur l'écran « Sample
 * papers » ; les petits boutons de démo du bas disparaissent : « Watch the
 * demo » les remplace.
 */
export function Accueil() {
  const { aller, profil, analyserDemo, occupe } = useRature()
  const plusieurs = TOUR_DEMO.length > 1
  const copieGuidee = TOUR_DEMO.slice(0, 4)

  return (
    <div className="errata-home">
      <section className="errata-hero">
        <div className="errata-hero-copy">
          <p className="errata-hero-kicker">A study app for students who hate red pen.</p>
          <h1>
            {TITRE.map((mot) => (
              <span key={mot}>
                <span className={mot === 'moves' ? 'errata-titre-mot errata-moves' : 'errata-titre-mot'}>
                  {mot}
                </span>{' '}
              </span>
            ))}
          </h1>
          <p className="errata-hero-lede">
            Photograph your corrected paper. We read the teacher&apos;s marks, sort them by error type,
            and build the exercise that works on <em>your</em> weakness.
          </p>
          <div className="errata-ctas">
            <Bouton onClick={() => aller('cadrage')}>Photograph my paper</Bouton>
            {plusieurs ? (
              <Bouton variante="blanc" onClick={() => void analyserDemo(copieGuidee)} disabled={occupe}>
                Watch the demo
              </Bouton>
            ) : null}
            <Bouton variante="menthe" onClick={() => aller('exemples')}>
              Try a sample paper
            </Bouton>
          </div>
          <div className="errata-proof-stickers" aria-hidden="true">
            <span className="sticker sticker-rose">No grades. Ever.</span>
            <span className="sticker sticker-blanc">12 error types</span>
          </div>
        </div>

        <BoardDuo />
      </section>

      <div className="errata-home-lower">
        <BandeauSante />
        {profil.totalAnalyses > 0 ? (
          <Carte titre="Continue" ton="vert">
            <p className="text-sm text-muet">{profil.totalAnalyses} paper(s) analysed on this device.</p>
            <div className="mt-3">
              <Bouton variante="secondaire" onClick={() => aller('profil')}>
                See my error profile
              </Bouton>
            </div>
          </Carte>
        ) : null}
        <p className="text-center text-xs text-white/75">
          Model answers recorded on {COPIES_DEMO.length} sample paper(s) · replayable offline · no key
          · no paper ever stored.
        </p>
      </div>
    </div>
  )
}

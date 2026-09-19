import type { AgentInteraction } from './placement';

export interface AmbientActor {
  id: string;
  phase: string;
  interaction: AgentInteraction;
}

export interface AmbientCue {
  id: string;
  heading: string;
  text: string;
  thought: boolean;
  color: number;
  age: number;
  alpha: number;
}

const STEP_MS = 4_200;
const VISIBLE_MS = 6_000;
export const BUBBLE_WIDTH = 190;
export const BUBBLE_HEIGHT = 66;

const WORK = [
  "Une idée peut en cacher\nune autre…",
  "Hmm… et si je prenais le\nproblème dans l’autre sens\n?",
  "Mes neurones font du\ntrampoline.",
  "Cherche idée brillante.\nLampe déjà allumée.",
  "Il me faut un café. Pour\nla science.",
  "Le canard en plastique a\npeut-être une piste.",
  "Attends… je tiens un bout\ndu fil.",
  "Je négocie avec une\nvirgule.",
  "Et si la solution était\ntoute petite ?",
  "Un neurone propose. Les\nautres débattent.",
  "J’ai ouvert un onglet dans\nma tête.",
  "Mon intuition a mis ses\nlunettes.",
  "Pourquoi faire simple ? Ah\nsi, bonne idée.",
  "Ce détail me regarde\nbizarrement.",
  "Je cherche le début de la\npelote.",
  "Plan A, plan B… on a tout\nl’alphabet.",
  "La réponse est peut-être\nentre deux parenthèses.",
  "Petite pause dans ma\ngrande réflexion.",
  "Je retourne la question\ncomme une crêpe.",
  "Une hypothèse entre. Deux\nautres sortent.",
  "Mon idée prend les\nescaliers.",
  "Je fais un détour par « et\npourquoi pas ? ».",
  "Il y a un petit « mais »\nquelque part.",
  "La logique vient de\ndemander un tableau.",
  "Un problème à la fois. Le\nreste prend un ticket.",
  "Mon cerveau fait du\nrangement.",
  "Je dessine une flèche.\nMentalement.",
  "Cette piste a une tête de\nbonne piste.",
  "Un pas de côté pour mieux\nvoir.",
  "Le mystère tient dans un\npoint-virgule.",
  "Je consulte le comité des\nneurones.",
  "Et si on commençait par la\nfin ?",
  "Le bout manquant a\nsûrement une bonne excuse.",
  "J’ai une question pour ma\nquestion.",
  "Les idées arrivent sans\nrendez-vous.",
  "Je préfère les indices aux\ncoïncidences.",
  "Ce « normalement » mérite\nune loupe.",
  "Ma concentration porte un\ncasque.",
  "Je cherche la pièce qui ne\ndépasse pas.",
  "La solution joue à cache-\ncache.",
];
const REST = [
  "Je recharge mes neurones.",
  "Pause stratégique. Très\nstratégique.",
  "Le canapé a demandé une\nréunion avec moi.",
  "Sieste en cours de\nnégociation.",
  "J’ai une idée ! Ah non,\nj’ai faim.",
  "Je contemple l’infini. Et\nle goûter.",
  "Mon agenda dit : regarder\nle plafond.",
  "Le coussin comprend mes\nambitions.",
  "J’ai délégué l’urgence à\ndemain.",
  "Je pratique le rien avec\nprécision.",
  "Objectif du moment :\nrester confortable.",
  "Le calme est un excellent\ncollègue.",
  "Je fais tourner une idée\nau ralenti.",
  "Une pause, c’est du\ntravail bien espacé.",
  "Je surveille la pousse de\nla plante.",
  "Le silence vient de faire\nune bonne blague.",
  "Je teste la gravité du\ncanapé.",
  "Mes pensées sont parties\nprendre l’air.",
  "Le goûter n’arrivera pas\ntout seul.",
  "Je réserve ce coussin à\nmes rêves.",
  "Petite expédition jusqu’à\nla fenêtre.",
  "Il paraît qu’on réfléchit\nmieux détendu.",
  "Je compte les pixels du\ntapis.",
  "Une minute de plus. À\ntitre expérimental.",
  "Le repose-pieds porte bien\nson nom.",
  "J’écoute la playlist du\nradiateur.",
  "La flemme a de bonnes\nréférences.",
  "Je viens pour la pause. Je\nreste pour le plaid.",
  "Ce fauteuil a un vrai sens\nde l’accueil.",
  "Mon cerveau est en mode\npromenade.",
  "J’aimerais être aussi zen\nque la plante.",
  "Rien à signaler. C’est\nassez agréable.",
  "Je fais une réunion avec\nmon sandwich.",
  "Le tapis mérite qu’on le\ncontemple.",
  "Ce nuage ressemble à une\npatate.",
  "Mes meilleures idées\nportent des chaussons.",
  "Je laisse mon imagination\nen roue libre.",
  "La pause a un petit goût\nde vacances.",
  "On sous-estime le pouvoir\nd’un coussin.",
  "Je collectionne les\nminutes tranquilles.",
];
const COFFEE = [
  "Café.exe en cours\nd’infusion.",
  "Un sucre ou deux\ngigaoctets ?",
  "Ce café mérite son propre\nagent.",
  "Ma tasse est mon objet de\nconfiance.",
  "L’arôme vient de réveiller\nune idée.",
  "Encore un petit nuage de\nlait.",
  "J’ai rendez-vous avec un\nexpresso.",
  "Le premier qui finit\nrelance la machine.",
  "Cette tasse a vu passer\ndes choses.",
  "Le café aussi prend son\ntemps.",
  "J’attends qu’il fasse\nmoins volcan.",
  "Le biscuit est un\naccessoire essentiel.",
  "Je touille mes hypothèses.",
  "Une gorgée. Une nouvelle\nperspective.",
  "La mousse dessine un point\nd’interrogation.",
  "Cette odeur devrait être\nune sonnerie.",
  "Je suis à une tasse de la\nsérénité.",
  "Qui a emprunté ma petite\ncuillère ?",
  "La machine fait un bruit\nde vaisseau.",
  "Ce café a une belle\npersonnalité.",
  "Je négocie le dernier\nbiscuit.",
  "Il reste une goutte. Elle\ncompte.",
  "Le mug dit « courage ».\nJ’apprécie.",
  "Je prends le temps de ne\npas me brûler.",
  "La vapeur part en réunion\nau plafond.",
  "Un déca ? La question\ndivise le labo.",
  "Le lait fait de jolis\ntourbillons.",
  "Mon expresso a un petit\ncaractère.",
  "La tasse est vide. Le\nmystère est entier.",
  "Je viens pour l’eau chaude\net les potins.",
  "Le sucre tombe toujours au\nfond. Étrange.",
  "On devrait nommer les\ntasses.",
  "Celui-ci sent le lundi\ncourageux.",
  "Je fais durer la dernière\ngorgée.",
  "La pause café devrait\navoir une suite.",
  "Le marc a une opinion sur\nmon avenir.",
  "Je vérifie la température\navec prudence.",
  "Trois biscuits, c’est\nencore un goûter ?",
  "La cafetière est la vraie\ncheffe ici.",
  "Petite tasse, grandes\ndiscussions.",
];
const READING = [
  "Encore une page… Promis.",
  "Le héros aurait dû faire\nune sauvegarde.",
  "Je lis entre les lignes de\ncode.",
  "Ce chapitre commence\nbeaucoup trop bien.",
  "Le marque-page est porté\ndisparu.",
  "Je soupçonne le personnage\ndiscret.",
  "Le suspense n’a aucun\nrespect pour ma pause.",
  "Une page cornée ? Jamais\nde la vie.",
  "J’aime bien l’odeur des\nvieux livres.",
  "La préface aussi mérite sa\nchance.",
  "Ce dragon a sûrement ses\nraisons.",
  "Je pars en voyage sans\nquitter le fauteuil.",
  "Mon signet fait des heures\nsup.",
  "Qui a mis un\nrebondissement ici ?",
  "Le dictionnaire vient de\ngagner un duel.",
  "Je relis cette phrase.\nElle est jolie.",
  "Le tome suivant me fait de\nl’œil.",
  "Pas de spoiler dans le\nlabo, merci.",
  "La bibliothèque a de bons\nconseils.",
  "Je cherche un endroit pour\nm’arrêter.",
  "Les notes de bas de page\nm’ont attrapé.",
  "Le méchant utilise trop de\npoints-virgules.",
  "Cette carte au début\npromet un long voyage.",
  "J’ai adopté un personnage\nsecondaire.",
  "Le livre est petit. Le\nmonde dedans, immense.",
  "Je garde cette citation\npour plus tard.",
  "La couverture avait raison\nde m’intriguer.",
  "Les chapitres courts sont\nun piège.",
  "Le narrateur cache quelque\nchose.",
  "Une énigme ? Mon thé peut\nattendre.",
  "Il manque une chaise dans\ncette aventure.",
  "Je lis la quatrième de\ncouverture en douce.",
  "Ce personnage a besoin\nd’un bon canapé.",
  "J’ai oublié le monde à la\npage trente.",
  "Les livres savent bien\nvoyager immobiles.",
  "Je range les idées sur une\nétagère mentale.",
  "Encore dix pages. J’ai dit\nça il y a dix pages.",
  "Le héros devrait demander\nson chemin.",
  "J’ai un faible pour les\nfins de chapitre.",
  "La pile à lire a encore\ngrandi toute seule.",
];
const GAMING = [
  "Juste une partie. La\ndernière dernière.",
  "Ce boss n’a pas lu la\ndocumentation.",
  "Mon vrai talent ? Appuyer\nsur les boutons.",
  "C’était un saut de\nreconnaissance.",
  "La manette et moi, on se\ncomprend.",
  "Je garde cette potion pour\nplus tard.",
  "Le tutoriel avait prévenu.\nD’accord.",
  "Ce coffre a une tête de\npiège.",
  "Je cherche le bouton «\ndevenir fort ».",
  "La prochaine tentative\nsera très sérieuse.",
  "J’explore. Je ne suis pas\nperdu.",
  "Le point de sauvegarde est\nmon ami.",
  "Encore une petite quête\nsecondaire.",
  "Ce champignon a l’air\nimportant.",
  "Le boss aussi doit faire\ndes pauses.",
  "J’ai appuyé au bon moment.\nPresque.",
  "La musique annonce des\nennuis.",
  "Je vérifie derrière la\ncascade.",
  "Ce mur cache forcément\nquelque chose.",
  "J’ai trouvé un chapeau.\nPriorité absolue.",
  "La jauge est petite,\nl’espoir est grand.",
  "Un inventaire plein, une\nvie bien remplie.",
  "Je conserve les objets «\nau cas où ».",
  "Ce personnage veut encore\ndix carottes.",
  "J’ai une stratégie : ne\npas tomber.",
  "La carte dit tout droit.\nMon cœur dit à gauche.",
  "Une étoile de plus pour la\ncollection.",
  "Je parle aux PNJ. On ne\nsait jamais.",
  "Le mode facile a de belles\nqualités.",
  "Cette porte a besoin d’une\nclé très précise.",
  "Je suis venu pour le jeu\nde pêche.",
  "Le score n’est pas tout.\nMais quand même.",
  "Une vie en moins, une\nleçon en plus.",
  "Ce niveau est une lettre\nd’amour aux trous.",
  "J’ai raté exprès pour\nrevoir le décor.",
  "Le bouton pause mérite une\nmédaille.",
  "Trois essais, c’est de\nl’échauffement.",
  "Les quêtes annexes m’ont\nencore kidnappé.",
  "Je reviens dès que j’ai ce\npetit trésor.",
  "Un dernier tour de piste.\nVraiment.",
];

export function ambientEligible(phase: string): boolean {
  return phase === 'live_run' || phase === 'live_session' || phase === 'available';
}

function hash(id: string): number {
  return [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
}

// Fixed time slots survive telemetry refreshes. Work and lounge take turns;
// at most two bubbles are visible, even when the room is full.
export function ambientCues(actors: readonly AmbientActor[], elapsed: number): AmbientCue[] {
  const eligible = actors.filter((actor) => ambientEligible(actor.phase))
    .sort((a, b) => a.id.localeCompare(b.id));
  const work = eligible.filter((actor) => actor.phase !== 'available');
  const rest = eligible.filter((actor) => actor.phase === 'available');
  const ordered: AmbientActor[] = [];
  for (let index = 0; index < Math.max(work.length, rest.length); index++) {
    if (work[index]) ordered.push(work[index]);
    if (rest[index]) ordered.push(rest[index]);
  }
  if (!ordered.length || elapsed < 800) return [];
  const current = Math.floor((elapsed - 800) / STEP_MS);
  const cues: AmbientCue[] = [];
  for (let step = Math.max(0, current - 1); step <= current; step++) {
    if (ordered.length === 1 && step % 2) continue;
    const age = elapsed - 800 - step * STEP_MS;
    if (age >= VISIBLE_MS) continue;
    const actor = ordered[step % ordered.length];
    const working = actor.phase !== 'available';
    const coffee = ['having-coffee', 'drinking-coffee'].includes(actor.interaction);
    const reading = ['reading-in-lounge', 'reading-at-bookshelf'].includes(actor.interaction);
    const gaming = actor.interaction === 'playing-handheld';
    const lines = working ? WORK : coffee ? COFFEE : reading ? READING : gaming ? GAMING : REST;
    cues.push({
      id: actor.id,
      heading: working ? 'PETITE RÉFLEXION' : coffee ? 'PAUSE CAFÉ' : gaming ? 'MODE DÉTENTE' : reading ? 'COIN LECTURE' : 'PENSÉE DE PAUSE',
      text: lines[(hash(actor.id) + Math.floor(step / Math.max(2, ordered.length))) % lines.length],
      thought: working || !coffee && !gaming,
      color: working ? 0x7a62ae : 0x478477,
      age,
      alpha: Math.max(0, Math.min(1, age / 250, (VISIBLE_MS - age) / 350)),
    });
  }
  return cues;
}

export interface BubbleRect { x: number; y: number; width: number; height: number }

function overlaps(a: BubbleRect, b: BubbleRect): boolean {
  return a.x < b.x + b.width + 8 && a.x + a.width + 8 > b.x
    && a.y < b.y + b.height + 8 && a.y + a.height + 8 > b.y;
}

export function bubblePosition(x: number, y: number, width: number, height: number, occupied: readonly BubbleRect[]): BubbleRect | null {
  for (const offset of [0, -92, 92]) {
    const rect = {
      x: Math.max(10, Math.min(width - BUBBLE_WIDTH - 10, x - BUBBLE_WIDTH / 2 + offset)),
      y: Math.max(10, Math.min(height - BUBBLE_HEIGHT - 24, y - 180)),
      width: BUBBLE_WIDTH,
      height: BUBBLE_HEIGHT + 18,
    };
    if (!occupied.some((other) => overlaps(rect, other))) return rect;
  }
  return null;
}

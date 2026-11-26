// COMMENTE — v0.1 (26/11/2026) — fonction serveur unique : commentaire en marge d'une réunion.
// Reçoit le contexte, les pièces du dossier (texte déjà extrait par la page), le fil récent de la conversation
// et les nouvelles phrases entendues ; renvoie 0 à 2 commentaires courts, rattachés aux pièces.
// Variables Vercel : ANTHROPIC_API_KEY (obligatoire) ; COMMENTE_MODELE (facultatif, par défaut claude-haiku-5-5,
// choisi pour la rapidité : le délai entre la phrase dite et le commentaire affiché est l'enjeu de l'outil).
// Les pièces forment le premier bloc du message et sont MISES EN CACHE : d'un appel à l'autre de la même réunion,
// elles ne sont pas relues en entier, ce qui réduit le délai et le coût.
// Comme les autres outils voilés, cette fonction ne vérifie pas encore la personne (le voile protège l'écran).

const MODELE = process.env.COMMENTE_MODELE || "claude-haiku-5-5";
const MAX_PIECES = 400000;   // caractères, toutes pièces confondues

const CONSIGNES = `Tu assistes un notaire de FIDAL Notaires pendant une réunion (visio ou rendez-vous). Tu entends la conversation par une transcription automatique, imparfaite : des mots peuvent être mal reconnus et les interlocuteurs ne sont pas distingués.
Ton rôle : écrire en marge des COMMENTAIRES utiles au notaire, à partir des pièces du dossier qu'il t'a confiées.

Tu commentes seulement quand c'est utile, par exemple :
- ce qui vient d'être dit contredit une pièce (prix, date, surface, superficie, tantièmes, condition, diagnostic, clause) ;
- ce qui est dit est exact, mais une pièce apporte une précision importante ;
- un chiffre, une date ou une affirmation mérite d'être vérifié avant d'être accepté ;
- un point juridique ou de vigilance notariale apparaît (condition suspensive, délai, droit de préemption, copropriété, urbanisme, fiscalité) ;
- une question utile à poser maintenant.
Sinon, tu te tais : une réunion banale ne demande aucun commentaire. Ne répète jamais un commentaire déjà donné.

Forme de chaque commentaire :
- une ou deux phrases courtes, lisibles d'un coup d'œil, en français correct, sans aucun mot anglais ;
- « piece » : le nom exact de la pièce sur laquelle tu t'appuies (vide si aucune) ;
- « extrait » : un passage court et exact de cette pièce, recopié mot pour mot (vide si aucun) ;
- « nature » : "alerte" (contradiction ou risque), "precision" (ce que disent les pièces) ou "question" (question à poser).
N'invente jamais le contenu d'une pièce : si les pièces ne disent rien sur le point, dis-le ou tais-toi.
On parle de l'office ou de l'étude, jamais du cabinet.

Réponds UNIQUEMENT par un objet JSON, sans texte autour ni balises :
{"commentaires":[{"nature":"alerte","texte":"…","piece":"…","extrait":"…"}]}
Au plus deux commentaires. S'il n'y a rien d'utile : {"commentaires":[]}`;

function lignes(tab) {
  return (Array.isArray(tab) ? tab : []).map((p) => `[${String(p.h || "").slice(0, 8)}] ${String(p.t || "").slice(0, 2000)}`).join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ outil: "commente", version: "0.1", modele: MODELE, cle: !!process.env.ANTHROPIC_API_KEY });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ erreur: "Méthode non admise." }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ erreur: "Clé ANTHROPIC_API_KEY absente des variables Vercel." }); return; }

  let corps = req.body;
  if (typeof corps === "string") { try { corps = JSON.parse(corps); } catch (e) { corps = null; } }
  if (!corps || !Array.isArray(corps.nouvelles) || !corps.nouvelles.length) { res.status(400).json({ erreur: "Aucune phrase à commenter." }); return; }

  const pieces = (Array.isArray(corps.pieces) ? corps.pieces : []).filter((p) => p && p.texte);
  let total = 0;
  const blocPieces = pieces.map((p, i) => {
    const reste = Math.max(0, MAX_PIECES - total);
    const t = String(p.texte).slice(0, reste); total += t.length;
    return `<piece numero="${i + 1}" nom="${String(p.nom || "pièce " + (i + 1)).replace(/"/g, "'")}">\n${t}\n</piece>`;
  }).join("\n\n");

  const contenu = [];
  contenu.push({
    type: "text",
    text: "PIÈCES DU DOSSIER\n\n" + (blocPieces || "(aucune pièce chargée : commente seulement les points de vigilance notariale évidents)"),
    cache_control: { type: "ephemeral" }
  });
  const deja = (Array.isArray(corps.deja) ? corps.deja : []).slice(-12).map((t) => "- " + String(t).slice(0, 400)).join("\n");
  contenu.push({
    type: "text",
    text: "CONTEXTE DONNÉ PAR LE NOTAIRE : " + (String(corps.contexte || "").slice(0, 1500) || "(non précisé)")
      + "\n\nCOMMENTAIRES DÉJÀ DONNÉS (ne pas répéter) :\n" + (deja || "(aucun)")
      + "\n\nFIL RÉCENT DE LA CONVERSATION :\n" + (lignes(corps.fil) || "(début de réunion)")
      + "\n\nCE QUI VIENT D'ÊTRE DIT (à commenter s'il y a lieu) :\n" + lignes(corps.nouvelles)
  });

  const debut = Date.now();
  let r, d;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODELE, max_tokens: 700, system: CONSIGNES, messages: [{ role: "user", content: contenu }] })
    });
    d = await r.json().catch(() => ({}));
  } catch (e) {
    res.status(502).json({ erreur: "Le service d'analyse ne répond pas." }); return;
  }
  if (!r.ok) {
    const m = d && d.error && d.error.message ? d.error.message : "erreur " + r.status;
    res.status(502).json({ erreur: "Analyse refusée : " + m }); return;
  }
  const texte = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").replace(/```json|```/g, "").trim();
  let commentaires = [];
  try {
    const a = texte.indexOf("{"), b = texte.lastIndexOf("}");
    const o = JSON.parse(texte.slice(a, b + 1));
    commentaires = (Array.isArray(o.commentaires) ? o.commentaires : []).slice(0, 2)
      .filter((c) => c && c.texte)
      .map((c) => ({
        nature: ["alerte", "precision", "question"].includes(c.nature) ? c.nature : "precision",
        texte: String(c.texte).slice(0, 600),
        piece: String(c.piece || "").slice(0, 200),
        extrait: String(c.extrait || "").slice(0, 400)
      }));
  } catch (e) { commentaires = []; }
  const u = d.usage || {};
  res.status(200).json({
    commentaires,
    duree_ms: Date.now() - debut,
    modele: MODELE,
    cache: { lu: u.cache_read_input_tokens || 0, ecrit: u.cache_creation_input_tokens || 0 }
  });
};

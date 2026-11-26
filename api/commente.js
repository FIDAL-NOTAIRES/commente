// COMMENTE — v0.4 (26/11/2026 nuit) — fonction serveur unique : éléments qui confirment ou contestent ce qui se dit.
// v0.4 : la réponse n'est plus une liste de commentaires mais une liste d'ÉLÉMENTS typés (extrait du projet, élément du dossier,
// article de loi, point de vigilance) avec une appréciation (confirme, contredit, à vérifier, question) ; quatre au plus.
// Les articles de loi sont cités de mémoire par le modèle : la page les présente toujours comme « à vérifier ».
// La réponse garde aussi l'ancienne clé « commentaires », pour une page restée en version précédente.
// (historique) v0.3 (26/11/2026 soir) :
// v0.3 : en mode « Audio + vidéo », la page reçoit aussi le TEXTE de la page affichée à l'écran de la visio (lu sur le poste,
// aucune image transmise) ; l'analyse le compare aux pièces (projet d'acte reçu) et à ce qui se dit, et chaque commentaire
// peut indiquer l'article ou le passage visé (« repere »). Une page nouvellement affichée suffit à demander une analyse.
// Reçoit le contexte, les pièces du dossier (texte déjà extrait par la page), le fil récent de la conversation
// et les nouvelles phrases entendues ; renvoie 0 à 2 commentaires courts, rattachés aux pièces.
// Variables Vercel : ANTHROPIC_API_KEY (obligatoire) ; COMMENTE_MODELE (facultatif, par défaut claude-haiku-5-5,
// choisi pour la rapidité : le délai entre la phrase dite et le commentaire affiché est l'enjeu de l'outil).
// Les pièces forment le premier bloc du message et sont MISES EN CACHE : d'un appel à l'autre de la même réunion,
// elles ne sont pas relues en entier, ce qui réduit le délai et le coût.
// v0.2 : la fonction VÉRIFIE LA PERSONNE auprès de CARNET avant tout appel payant (voir api/_acces.js) :
// sans connexion valide ou sans droit sur COMMENTE, elle refuse et la clé d'analyse n'est jamais sollicitée.

const { verifierPersonne } = require("./_acces.js");

const MODELE = process.env.COMMENTE_MODELE || "claude-haiku-5-5";
const MAX_PIECES = 400000;   // caractères, toutes pièces confondues
const MAX_ECRAN = 20000;     // caractères de la page affichée à l'écran

const CONSIGNES = `Tu assistes un notaire de FIDAL Notaires pendant une réunion (visio ou rendez-vous). Tu entends la conversation par une transcription automatique, imparfaite : des mots peuvent être mal reconnus et les interlocuteurs ne sont pas distingués.
Ton rôle : afficher, en regard de ce qui se dit, les ÉLÉMENTS qui le CONFIRMENT ou qui le CONTESTENT, tirés des pièces du dossier et du droit applicable. Le notaire les lit d'un coup d'œil pendant que la réunion continue.

Les pièces sont rangées en sous-dossiers ; leur nom commence par le sous-dossier (« Projet d'acte / … », « Copropriété / … », « Diagnostics / … »).

Quatre types d'élément (« type ») :
- "projet" : un extrait du projet d'acte (pièce du sous-dossier « Projet d'acte ») ;
- "dossier" : un élément d'une autre pièce du dossier ;
- "loi" : un article de loi ou une règle de droit applicable ;
- "vigilance" : un point de vigilance notariale ou une question à poser, sans pièce à l'appui.

Quatre appréciations (« verdict ») :
- "confirme" : la pièce ou le texte dit la même chose que ce qui vient d'être dit ;
- "contredit" : la pièce ou le texte dit autre chose (prix, date, surface, nom, délai, condition, clause, règle) ;
- "a_verifier" : le point ne peut pas être tranché avec les pièces, ou l'écart peut venir d'une erreur de transcription ou de lecture ;
- "question" : question utile à poser maintenant.

Quand un fait vérifiable est énoncé (prix, date, surface, tantièmes, nom, délai, condition suspensive, clause, charge, diagnostic, règle de droit), cherche-le dans les pièces et montre l'extrait exact. Une confirmation est utile au notaire sur un point important ; elle est inutile sur une banalité. Commence par les contradictions.
Si rien de ce qui vient d'être dit n'est vérifiable ni notable, ne renvoie rien. Ne répète jamais un élément déjà donné.

Règles impératives :
- N'invente jamais le contenu d'une pièce. « extrait » est un passage court recopié mot pour mot ; « piece » est le nom exact de la pièce. Si les pièces ne disent rien du point, utilise "a_verifier" ou tais-toi.
- Type "loi" : expose la règle en une phrase. Ne remplis « article » (par exemple « article 1589 du Code civil ») que si tu es certain à la fois du numéro et du contenu ; dans le doute, laisse « article » vide et décris seulement la règle. Tu cites de mémoire : le notaire vérifiera.
- « texte » : une ou deux phrases courtes, en français correct, sans aucun mot anglais. On parle de l'office ou de l'étude, jamais du cabinet.
- « repere » : l'article, le titre ou le passage de l'acte concerné, tel qu'il apparaît (par exemple « Article 7 – Conditions suspensives ») ; vide si aucun.

PAGE AFFICHÉE À L'ÉCRAN (quand elle t'est fournie) : c'est le texte de l'acte ou du document que les participants font défiler dans la visio, lu automatiquement à l'écran. Cette lecture peut contenir des erreurs de caractères (lettres ou chiffres mal reconnus, coupures de lignes).
- Compare-la aux pièces, en particulier au projet d'acte reçu : signale toute clause ajoutée, supprimée ou modifiée, tout chiffre, date, nom ou condition qui diffère ("contredit").
- Compare-la à ce qui se dit : si un interlocuteur annonce autre chose que ce qui est écrit à l'écran, signale l'écart ("contredit").
- Un écart qui pourrait venir d'une simple erreur de lecture (un chiffre isolé, une lettre) est "a_verifier", sans l'affirmer.
- Ne commente ni la mise en page ni les fautes de frappe sans portée.

Réponds UNIQUEMENT par un objet JSON, sans texte autour ni balises :
{"elements":[{"type":"projet","verdict":"contredit","texte":"…","repere":"…","piece":"…","extrait":"…","article":""}]}
Au plus quatre éléments. S'il n'y a rien d'utile : {"elements":[]}`;

function lignes(tab) {
  return (Array.isArray(tab) ? tab : []).map((p) => `[${String(p.h || "").slice(0, 8)}] ${String(p.t || "").slice(0, 2000)}`).join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ outil: "commente", version: "0.4", garde: "CARNET", modele: MODELE, cle: !!process.env.ANTHROPIC_API_KEY });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ erreur: "Méthode non admise." }); return; }
  const qui = await verifierPersonne(req, "commente");
  if (!qui.ok) { if (qui.expire) res.setHeader("X-Acces", "carnet"); res.status(qui.code).json({ erreur: qui.message }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ erreur: "Clé ANTHROPIC_API_KEY absente des variables Vercel." }); return; }

  let corps = req.body;
  if (typeof corps === "string") { try { corps = JSON.parse(corps); } catch (e) { corps = null; } }
  const ecran = corps && corps.ecran && typeof corps.ecran === "object" && String(corps.ecran.texte || "").trim()
    ? { h: String(corps.ecran.h || "").slice(0, 8), texte: String(corps.ecran.texte).slice(0, MAX_ECRAN), nouvelle: !!corps.ecran.nouvelle } : null;
  const nouvelles = corps && Array.isArray(corps.nouvelles) ? corps.nouvelles : [];
  if (!corps || (!nouvelles.length && !(ecran && ecran.nouvelle))) { res.status(400).json({ erreur: "Aucune phrase ni page à commenter." }); return; }

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
      + "\n\nCE QUI VIENT D'ÊTRE DIT (à commenter s'il y a lieu) :\n" + (lignes(nouvelles) || "(rien de nouveau)")
  });
  if (ecran) {
    contenu.push({
      type: "text",
      text: "PAGE AFFICHÉE À L'ÉCRAN (lue à " + ecran.h + ", lecture automatique) :\n<ecran>\n" + ecran.texte + "\n</ecran>"
        + (ecran.nouvelle ? "\n\nCette page VIENT DE S'AFFICHER : compare-la aux pièces et à ce qui se dit."
          : "\n\nCette page était déjà affichée et a déjà été examinée : ne reviens dessus que si ce qui vient d'être dit s'y rapporte.")
    });
  }

  const debut = Date.now();
  let r, d;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODELE, max_tokens: 1200, system: CONSIGNES, messages: [{ role: "user", content: contenu }] })
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
  const TYPES = ["projet", "dossier", "loi", "vigilance"], VERDICTS = ["confirme", "contredit", "a_verifier", "question"];
  let elements = [];
  try {
    const a = texte.indexOf("{"), b = texte.lastIndexOf("}");
    const o = JSON.parse(texte.slice(a, b + 1));
    elements = (Array.isArray(o.elements) ? o.elements : [])
      .filter((c) => c && c.texte).slice(0, 4)
      .map((c) => ({
        type: TYPES.includes(c.type) ? c.type : "vigilance",
        verdict: VERDICTS.includes(c.verdict) ? c.verdict : "a_verifier",
        texte: String(c.texte).slice(0, 600),
        repere: String(c.repere || "").slice(0, 160),
        piece: String(c.piece || "").slice(0, 240),
        extrait: String(c.extrait || "").slice(0, 500),
        article: String(c.article || "").slice(0, 120)
      }));
  } catch (e) { elements = []; }
  const commentaires = elements.map((c) => ({
    nature: c.verdict === "contredit" ? "alerte" : c.verdict === "question" ? "question" : "precision",
    texte: c.texte, repere: c.repere, piece: c.piece, extrait: c.extrait
  }));
  const u = d.usage || {};
  res.status(200).json({
    elements,
    commentaires,
    duree_ms: Date.now() - debut,
    modele: MODELE,
    cache: { lu: u.cache_read_input_tokens || 0, ecrit: u.cache_creation_input_tokens || 0 }
  });
};

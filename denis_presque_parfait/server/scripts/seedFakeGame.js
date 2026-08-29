// Fabrique une partie complète et cohérente pour tester le pipeline vidéo sans avoir
// à jouer une vraie partie à la main.
//
// ⚠️ Ce script vide ENTIÈREMENT la base avant de générer les données fictives — à
// n'utiliser qu'en local pour tester l'enregistrement vidéo, jamais en production.
const db = require("../db");

function seedFakeCompletedGame() {
  console.log("[SEED] Réinitialisation complète de la base (données de test uniquement)...");
  db.resetDatabase();

  console.log("[SEED] Génération d'une partie fictive complète...");

  const names = ["Alice", "Bilal", "Chloé"];
  const participants = names.map((name) => {
    const result = db.addParticipant(name);
    if (!result.ok) throw new Error(`[SEED] Échec ajout participant "${name}": ${result.error}`);
    return result.participant;
  });

  const today = db.todayStr();
  const [y, m, d] = today.split("-").map(Number);
  participants.forEach((p, i) => {
    const date = new Date(y, m - 1, d + i);
    const pad2 = (n) => String(n).padStart(2, "0");
    const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const result = db.setAssignment(dateStr, p.id);
    if (!result.ok) throw new Error(`[SEED] Échec assignation pour "${p.name}": ${result.error}`);
  });

  const criteria = [
    db.addCriterion("Le goût", 5, 2),
    db.addCriterion("La présentation", 5, 1),
    db.addCriterion("L'originalité", 5, 1),
  ];

  // Chaque participant note tous les autres, sur la date réellement assignée à la cible.
  const assignmentByParticipant = {};
  participants.forEach((p) => {
    assignmentByParticipant[p.id] = db.getAssignmentForParticipant(p.id).date;
  });

  participants.forEach((target) => {
    participants
      .filter((voter) => voter.id !== target.id)
      .forEach((voter) => {
        const scores = criteria.map((c) => ({
          criterion_id: c.id,
          score: 1 + Math.floor(Math.random() * c.max_note),
        }));
        db.submitVotes(assignmentByParticipant[target.id], voter.id, target.id, scores);
      });
  });

  const finalStatus = db.computeGameStatus();
  console.log("[SEED] Partie fictive prête, statut complet :", finalStatus);

  if (!finalStatus.complete) {
    throw new Error("[SEED] La partie fictive générée n'est toujours pas complète — vérifie la logique ci-dessus.");
  }
}

module.exports = { seedFakeCompletedGame };
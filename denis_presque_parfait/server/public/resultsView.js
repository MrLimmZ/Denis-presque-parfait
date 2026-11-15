// Rendu partagé des résultats (podium + classement détaillé), utilisé par la page
// résultats de la partie en cours et par la page des éditions archivées.
const ResultsView = (function () {
  // En mode équipes, rappelle qui composait l'équipe sous son nom.
  // Notes par catégorie (ex : "Plat 7,4 · Dessert 8,1") quand les critères en ont.
  function categoriesLine(result) {
    if (!result.categories || result.categories.length < 2) return "";
    const parts = result.categories.map(
      (c) => `${escapeHtml(c.category)} ${String(c.score_out_of_10).replace(".", ",")}`
    );
    return `<span class="ranking-categories">${parts.join(" · ")}</span>`;
  }

  function membersLine(result, className) {
    if (result.kind !== "team" || !result.members || result.members.length === 0) return "";
    return `<span class="${className}">${escapeHtml(result.members.map((m) => m.name).join(", "))}</span>`;
  }

  // Calcule le rang "sportif" de chaque résultat (1, 2, 2, 4, ...) : deux scores
  // identiques partagent le même rang, et le rang suivant saute en conséquence.
  // Renvoie un tableau aligné sur `results`, avec pour chaque entrée son rang et
  // si elle est effectivement à égalité avec au moins une autre personne.
  function computeRanks(results) {
    const ranks = [];
    for (let i = 0; i < results.length; i++) {
      if (i > 0 && results[i].overall_average_out_of_10 === results[i - 1].overall_average_out_of_10) {
        ranks.push(ranks[i - 1]);
      } else {
        ranks.push(i + 1);
      }
    }
    const countByRank = {};
    ranks.forEach((r) => (countByRank[r] = (countByRank[r] || 0) + 1));
    return ranks.map((r) => ({ rank: r, tied: countByRank[r] > 1 }));
  }

  // Regroupe les résultats déjà triés par palier de rang (1er, 2e, 3e...), peu
  // importe combien de personnes partagent ce rang.
  function groupByRank(results, ranks) {
    const groups = [];
    results.forEach((r, i) => {
      const rankInfo = ranks[i];
      const last = groups[groups.length - 1];
      if (last && last.rank === rankInfo.rank) {
        last.items.push(r);
      } else {
        groups.push({ rank: rankInfo.rank, tied: rankInfo.tied, items: [r] });
      }
    });
    return groups;
  }

  function renderPodium(podiumEl, results, ranks) {
    // Les 3 premiers PALIERS distincts (pas les 3 premières personnes) : si 3
    // personnes sont ex æquo à la 2e place, elles tiennent toutes dans la case
    // "argent", qui s'élargit pour les accueillir.
    const groups = groupByRank(results, ranks).slice(0, 3);
    podiumEl.innerHTML = "";

    // Position visuelle classique conservée : argent à gauche, or au centre,
    // bronze à droite — même quand un palier compte plusieurs personnes.
    const visualOrder = [1, 0, 2].filter((tierIndex) => groups[tierIndex]);

    visualOrder.forEach((tierIndex) => {
      const group = groups[tierIndex];
      const isMulti = group.items.length > 1;

      const block = document.createElement("div");
      block.className = `podium-block podium-rank-${tierIndex + 1}${isMulti ? " podium-block-tied" : ""}`;
      block.dataset.rankIndex = tierIndex;

      let peopleHtml;
      if (isMulti) {
        // Ex æquo : pas de nom individuel (ça déborderait de la colonne), juste
        // les avatars en pile, légèrement superposés les uns sur les autres.
        const avatarsHtml = group.items
          .map((r) => `<div class="podium-avatar-stack-item">${renderAvatarHTML(r, "md")}</div>`)
          .join("");
        peopleHtml = `<div class="podium-avatar-stack">${avatarsHtml}</div>`;
      } else {
        const r = group.items[0];
        peopleHtml = `
          ${renderAvatarHTML(r, "lg")}
          <span class="podium-name">${escapeHtml(r.participant_name)}</span>
          ${membersLine(r, "podium-members")}
        `;
      }

      // La moyenne est la même pour tout le palier (c'est la définition même de
      // l'ex æquo) : un seul chiffre affiché, partagé par tout le groupe.
      const sharedScore = group.items[0].overall_average_out_of_10;

      block.innerHTML = `
        <span class="podium-rank-badge">${group.rank}</span>
        ${peopleHtml}
        ${group.tied ? `<span class="podium-tie-label">Ex æquo</span>` : ""}
        <span class="podium-score" data-final="${sharedScore}">0.0</span>
      `;
      podiumEl.appendChild(block);
    });
  }

  function buildDetailTable(result) {
    const voterNames = [...new Set(result.criteria.flatMap((c) => c.votes.map((v) => v.voter_name)))];
    const missingNames = (result.missing_voters || []).map((v) => v.name);

    // Colonnes des votants ayant réellement noté, suivies des colonnes des
    // absents (grisées, avec "Absent" écrit dans chaque case).
    const columns = [
      ...voterNames.map((name) => ({ name, absent: false })),
      ...missingNames.map((name) => ({ name, absent: true })),
    ];

    let html = `<table class="votes-table"><thead><tr><th>Critère</th>`;
    columns.forEach((col) => {
      html += `<th class="votes-table-score-col${col.absent ? " voter-col-absent" : ""}">${col.name}</th>`;
    });
    html += `<th class="votes-table-avg-col">Moyenne</th></tr></thead><tbody>`;
    // Une ligne d'en-tête par catégorie (ex : "Plat · 7,4/10"), quand il y en a.
    const catScores = new Map((result.categories || []).map((c) => [c.category, c.score_out_of_10]));
    let currentCategory;
    result.criteria.forEach((c) => {
      const category = c.category || (catScores.size ? "Autres" : null);
      if (category && category !== currentCategory) {
        currentCategory = category;
        const score = catScores.get(category);
        html += `<tr class="votes-table-category"><td colspan="${columns.length + 2}">${escapeHtml(category)}${
          score != null ? ` <span class="votes-table-category-score">${String(score).replace(".", ",")}/10</span>` : ""
        }</td></tr>`;
      }
      html += `<tr><td>${escapeHtml(c.label)}</td>`;
      columns.forEach((col) => {
        if (col.absent) {
          html += `<td class="votes-table-score-col voter-col-absent">Absent</td>`;
        } else {
          const vote = c.votes.find((v) => v.voter_name === col.name);
          html += `<td class="votes-table-score-col">${vote ? `${vote.score}/${c.max_note}` : "—"}</td>`;
        }
      });
      html += `<td class="votes-table-avg-col"><strong>${c.average}/${c.max_note}</strong></td></tr>`;
    });
    html += `</tbody></table>`;

    // Points bonus : révélés ici (qui a donné à qui), avec la note des repas seule.
    if (result.bonus_count > 0) {
      const pts = String(result.bonus_points).replace(".", ",");
      const base = String(result.base_score_out_of_10).replace(".", ",");
      html += `
        <p class="bonus-detail">
          <span class="bonus-detail-star">★</span>
          ${result.bonus_count} point${result.bonus_count > 1 ? "s" : ""} bonus (+${pts}) de
          <strong>${escapeHtml(result.bonus_from.join(", "))}</strong>
          <span class="bonus-detail-base">· note des repas : ${base}/10</span>
        </p>`;
    }

    return html;
  }

  function renderRankingList(rankingListEl, results, ranks) {
    rankingListEl.innerHTML = "";
    let openDetailEl = null;
    results.forEach((r, index) => {
      const rankInfo = ranks[index];
      const item = document.createElement("div");
      item.className = "ranking-item";

      const row = document.createElement("button");
      row.className = "ranking-row";
      const missingCount = (r.missing_voters && r.missing_voters.length) || 0;
      const missingBadge =
        missingCount > 0
          ? `<span class="ranking-missing-badge" title="${missingCount} votant(s) n'a/n'ont pas pu noter">⚠ ${missingCount}</span>`
          : "";
      const tieBadge = rankInfo.tied ? `<span class="ranking-tie-badge">Ex æquo</span>` : "";
      row.innerHTML = `
        <span class="ranking-position">${rankInfo.rank}</span>
        ${renderAvatarHTML(r, "sm")}
        <span class="ranking-name">${escapeHtml(r.participant_name)}${tieBadge}${membersLine(r, "ranking-members")}${categoriesLine(r)}</span>
        ${missingBadge}
        ${r.bonus_count > 0 ? `<span class="ranking-bonus-badge" title="Points bonus reçus">★ ${r.bonus_count}</span>` : ""}
        <span class="ranking-score" data-final="${r.overall_average_out_of_10}">0.0</span>
      `;

      const detail = document.createElement("div");
      detail.className = "ranking-detail";
      detail.innerHTML = buildDetailTable(r);
      detail.style.display = "none";

      row.addEventListener("click", () => {
        const isCurrentlyOpen = detail.style.display !== "none";
        if (openDetailEl && openDetailEl !== detail) openDetailEl.style.display = "none";
        detail.style.display = isCurrentlyOpen ? "none" : "block";
        openDetailEl = isCurrentlyOpen ? null : detail;
      });

      item.appendChild(row);
      item.appendChild(detail);
      rankingListEl.appendChild(item);
    });
  }

  return { computeRanks, groupByRank, renderPodium, buildDetailTable, renderRankingList };
})();

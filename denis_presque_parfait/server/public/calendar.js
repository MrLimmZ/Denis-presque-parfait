function createCalendar({
  container,
  editable = false,
  allowRemove = true,
  today = null,
  onAssign,
  onUnassign,
  onMonthChange,
  onError,
} = {}) {
  const todayStr = today || (typeof todayDateString === "function" ? todayDateString() : null);
  const now = new Date();
  let currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let assignmentsByDate = {};
  // Sélection au toucher (le drag & drop HTML5 ne marche pas sur mobile) : on
  // touche un cuisinier, puis le jour où le déplacer / avec qui l'échanger.
  let selected = null; // { date, cook_id }

  // Appelle onAssign avec l'occupant éventuel du jour cible (pour confirmer un échange).
  function requestAssign(targetDate, cookId) {
    const occupant = assignmentsByDate[targetDate];
    const sourceDate = Object.keys(assignmentsByDate).find(
      (d) => String(assignmentsByDate[d].cook_id) === String(cookId)
    );
    if (occupant && String(occupant.cook_id) === String(cookId)) return;
    onAssign &&
      onAssign(targetDate, Number(cookId), {
        occupant: occupant || null,
        source: sourceDate ? { date: sourceDate, ...assignmentsByDate[sourceDate] } : null,
      });
  }

  const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function render() {
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "calendar-header";

    const navGroup = document.createElement("div");
    navGroup.className = "calendar-nav-group";

    const prevBtn = document.createElement("button");
    prevBtn.className = "calendar-nav";
    prevBtn.textContent = "←";
    prevBtn.setAttribute("aria-label", "Mois précédent");
    prevBtn.addEventListener("click", () => changeMonth(-1));

    const label = document.createElement("span");
    label.className = "calendar-month-label";
    label.textContent = currentMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

    const nextBtn = document.createElement("button");
    nextBtn.className = "calendar-nav";
    nextBtn.textContent = "→";
    nextBtn.setAttribute("aria-label", "Mois suivant");
    nextBtn.addEventListener("click", () => changeMonth(1));

    navGroup.appendChild(prevBtn);
    navGroup.appendChild(label);
    navGroup.appendChild(nextBtn);

    const todayBtn = document.createElement("button");
    todayBtn.className = "calendar-today-btn";
    todayBtn.textContent = "Aujourd'hui";
    todayBtn.addEventListener("click", () => goToCurrentMonth());

    header.appendChild(navGroup);
    header.appendChild(todayBtn);
    container.appendChild(header);

    const weekdaysRow = document.createElement("div");
    weekdaysRow.className = "calendar-weekdays";
    WEEKDAYS.forEach((d) => {
      const el = document.createElement("span");
      el.textContent = d;
      weekdaysRow.appendChild(el);
    });
    container.appendChild(weekdaysRow);

    const grid = document.createElement("div");
    grid.className = "calendar-grid";

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startOffset; i++) {
      const empty = document.createElement("div");
      empty.className = "calendar-day calendar-day-empty";
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
      const isPast = todayStr ? dateStr < todayStr : false;

      const cell = document.createElement("div");
      cell.className = "calendar-day";
      if (isPast) cell.classList.add("calendar-day-past");
      cell.dataset.date = dateStr;

      const dayNum = document.createElement("span");
      dayNum.className = "calendar-day-number";
      dayNum.textContent = day;
      cell.appendChild(dayNum);

      const assignment = assignmentsByDate[dateStr];
      const isLocked = !!(assignment && assignment.has_votes);

      if (assignment) {
        const chip = document.createElement("div");
        chip.className = "calendar-chip";

        if (isPast && isLocked) {
          chip.classList.add("calendar-chip-done");
        } else if (isPast && !isLocked) {
          chip.classList.add("calendar-chip-missed");
        } else {
          chip.style.background =
            typeof ThemeManager !== "undefined" ? ThemeManager.cookColor(assignment) : assignment.avatar_color || "var(--accent)";
        }

        chip.appendChild(createCookAvatarElement(assignment, "xs"));

        const nameSpan = document.createElement("span");
        nameSpan.className = "calendar-chip-name";
        nameSpan.textContent = assignment.cook_name;
        if (assignment.kind === "team") {
          chip.classList.add("calendar-chip-team");
          chip.title = `${assignment.cook_name} : ${(assignment.members || []).map((m) => m.name).join(", ")}`;
        }
        chip.appendChild(nameSpan);

        const isSelected = selected && selected.date === dateStr;
        if (isSelected) chip.classList.add("calendar-chip-selected");

        if (editable && !isLocked && !isPast) {
          chip.addEventListener("click", (e) => {
            e.stopPropagation();
            if (selected && selected.date !== dateStr) {
              // Un autre cuisinier était sélectionné : on l'échange avec celui-ci.
              const cookId = selected.cook_id;
              selected = null;
              requestAssign(dateStr, cookId);
              render();
              return;
            }
            selected = isSelected ? null : { date: dateStr, cook_id: assignment.cook_id };
            render();
          });
        }

        if (editable && !isLocked) {
          chip.draggable = true;
          chip.classList.add("calendar-chip-draggable");
          chip.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/cook-id", assignment.cook_id);
            e.stopPropagation();
          });

          const removeBtn = document.createElement("button");
          removeBtn.className = "calendar-chip-remove";
          removeBtn.textContent = "×";
          removeBtn.setAttribute("aria-label", "Retirer");
          removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            onUnassign && onUnassign(dateStr);
          });
          if (allowRemove) chip.appendChild(removeBtn);
        }

        cell.appendChild(chip);
      }

      const canDrop = editable && !isPast && !isLocked;

      if (editable) {
        cell.addEventListener("dragover", (e) => {
          if (!canDrop) return;
          e.preventDefault();
          cell.classList.add("calendar-day-dragover");
        });
        cell.addEventListener("dragleave", () => {
          cell.classList.remove("calendar-day-dragover");
        });
        cell.addEventListener("drop", (e) => {
          e.preventDefault();
          cell.classList.remove("calendar-day-dragover");
          if (!canDrop) return;
          const cookId = e.dataTransfer.getData("text/cook-id");
          if (cookId) {
            selected = null;
            requestAssign(dateStr, Number(cookId));
          }
        });

        cell.addEventListener("click", () => {
          if (!selected || !canDrop) return;
          const cookId = selected.cook_id;
          selected = null;
          requestAssign(dateStr, cookId);
          render();
        });
        if (selected && canDrop && !assignment) cell.classList.add("calendar-day-target");
      }

      grid.appendChild(cell);
    }

    container.appendChild(grid);
  }

  function changeMonth(delta) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
    assignmentsByDate = {};
    render();
    onMonthChange && onMonthChange(monthKey(currentMonth));
  }

  function goToCurrentMonth() {
    const n = new Date();
    currentMonth = new Date(n.getFullYear(), n.getMonth(), 1);
    assignmentsByDate = {};
    render();
    onMonthChange && onMonthChange(monthKey(currentMonth));
  }

  // Les couleurs des pastilles dépendent du thème : on redessine au changement.
  // (Le calendrier d'une page quittée se désabonne de lui-même.)
  function onThemeChange() {
    if (!container.isConnected) {
      document.removeEventListener("themechange", onThemeChange);
      return;
    }
    render();
  }
  document.addEventListener("themechange", onThemeChange);

  return {
    init() {
      render();
      onMonthChange && onMonthChange(monthKey(currentMonth));
    },
    getCurrentMonthKey() {
      return monthKey(currentMonth);
    },
    // Pré-sélectionne un cuisinier pas encore planifié (pastille touchée sur mobile) :
    // le prochain jour touché lui sera attribué.
    selectCook(cookId) {
      selected = cookId ? { date: null, cook_id: cookId } : null;
      render();
    },
    setAssignments(month, list) {
      if (month !== monthKey(currentMonth)) return;
      assignmentsByDate = {};
      (list || []).forEach((a) => {
        assignmentsByDate[a.date] = { ...a, has_votes: !!a.has_votes };
      });
      render();
    },
    // assignment : cuisinier normalisé envoyé par le serveur ({ cook_id, cook_name,
    // kind, members, avatar_*, has_votes }), ou null si le jour est libéré.
    applyUpdate(date, assignment) {
      if (!date.startsWith(monthKey(currentMonth))) return;
      if (assignment) {
        assignmentsByDate[date] = { ...assignment, has_votes: !!assignment.has_votes };
      } else {
        delete assignmentsByDate[date];
      }
      render();
    },
  };
}
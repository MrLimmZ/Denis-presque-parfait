function createCalendar({ container, editable = false, today = null, onAssign, onUnassign, onMonthChange, onError } = {}) {
  const todayStr = today || (typeof todayDateString === "function" ? todayDateString() : null);
  const now = new Date();
  let currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let assignmentsByDate = {};

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
          chip.style.background = assignment.avatar_color || "var(--accent)";
        }

        chip.appendChild(createAvatarElement(assignment, "xs"));

        const nameSpan = document.createElement("span");
        nameSpan.className = "calendar-chip-name";
        nameSpan.textContent = assignment.participant_name;
        chip.appendChild(nameSpan);

        if (editable && !isLocked) {
          chip.draggable = true;
          chip.classList.add("calendar-chip-draggable");
          chip.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/participant-id", assignment.participant_id);
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
          chip.appendChild(removeBtn);
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
          const participantId = e.dataTransfer.getData("text/participant-id");
          if (participantId) {
            onAssign && onAssign(dateStr, Number(participantId));
          }
        });
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

  return {
    init() {
      render();
      onMonthChange && onMonthChange(monthKey(currentMonth));
    },
    getCurrentMonthKey() {
      return monthKey(currentMonth);
    },
    setAssignments(month, list) {
      if (month !== monthKey(currentMonth)) return;
      assignmentsByDate = {};
      (list || []).forEach((a) => {
        assignmentsByDate[a.date] = {
          participant_id: a.participant_id,
          participant_name: a.participant_name,
          has_votes: !!a.has_votes,
          avatar_icon: a.avatar_icon,
          avatar_color: a.avatar_color,
          avatar_image: a.avatar_image,
        };
      });
      render();
    },
    applyUpdate(date, participantId, participantName, hasVotes, avatarIcon, avatarColor, avatarImage) {
      if (!date.startsWith(monthKey(currentMonth))) return;
      if (participantId) {
        assignmentsByDate[date] = {
          participant_id: participantId,
          participant_name: participantName,
          has_votes: !!hasVotes,
          avatar_icon: avatarIcon,
          avatar_color: avatarColor,
          avatar_image: avatarImage,
        };
      } else {
        delete assignmentsByDate[date];
      }
      render();
    },
  };
}
function buildWsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const basePath = location.pathname.replace(/\/[^/]*$/, "/");
  return `${proto}//${location.host}${basePath}ws`;
}

function buildBaseUrl() {
  const basePath = location.pathname.replace(/\/[^/]*$/, "/");
  return `${location.protocol}//${location.host}${basePath}`;
}

function connectWS({
  onParticipants,
  onCriteria,
  onCriteriaError,
  onAssignmentsList,
  onAssignmentGet,
  onAssignmentForParticipant,
  onAssignmentUpdate,
  onAssignmentError,
  onVotesList,
  onVotesSubmitted,
  onHasVotedToday,
  onVotersForDate,
  onVoterUpdate,
  onGameStatus,
  onGameComplete,
  onDbResetDone,
  onOpen,
  onClose,
} = {}) {
  const messageQueue = [];

  const handle = {
    socket: null,
    send(data) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(data);
      } else {
        messageQueue.push(data);
      }
    },
    get readyState() {
      return this.socket ? this.socket.readyState : WebSocket.CLOSED;
    },
  };

  function open() {
    const ws = new WebSocket(buildWsUrl());
    handle.socket = ws;

    ws.addEventListener("open", () => {
      while (messageQueue.length > 0) {
        ws.send(messageQueue.shift());
      }
      onOpen && onOpen();
    });
    ws.addEventListener("close", () => {
      onClose && onClose();
      setTimeout(open, 2000);
    });
    ws.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "participants" && onParticipants) onParticipants(data.list);
      if (data.type === "criteria" && onCriteria) onCriteria(data.list);
      if (data.type === "criteria:error" && onCriteriaError) onCriteriaError(data.message);
      if (data.type === "assignments:list" && onAssignmentsList) onAssignmentsList(data.month, data.list);
      if (data.type === "assignments:get" && onAssignmentGet) onAssignmentGet(data.date, data.assignment);
      if (data.type === "assignments:get_for_participant" && onAssignmentForParticipant) {
        onAssignmentForParticipant(data.participant_id, data.date);
      }
      if (data.type === "assignments:update" && onAssignmentUpdate) {
        onAssignmentUpdate(
          data.date,
          data.participant_id,
          data.participant_name,
          data.has_votes,
          data.avatar_icon,
          data.avatar_color
        );
      }
      if (data.type === "assignments:error" && onAssignmentError) onAssignmentError(data.message);
      if (data.type === "votes:list" && onVotesList) onVotesList(data.list);
      if (data.type === "votes:submitted" && onVotesSubmitted) onVotesSubmitted();
      if (data.type === "votes:has_voted_today" && onHasVotedToday) onHasVotedToday(data.hasVoted);
      if (data.type === "votes:voters_for_date" && onVotersForDate) {
        onVotersForDate(data.date, data.target_participant_id, data.voter_ids);
      }
      if (data.type === "votes:voter_update" && onVoterUpdate) {
        onVoterUpdate(data.date, data.target_participant_id, data.voter_participant_id);
      }
      if (data.type === "game:status" && onGameStatus) onGameStatus(data.complete, data.results);
      if (data.type === "game:complete" && onGameComplete) onGameComplete(data.results);
      if (data.type === "db:reset:done" && onDbResetDone) onDbResetDone();
    });
  }

  open();
  return handle;
}

// --- Cookies ---

function setCookie(name, value, days = 180) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function deleteCookie(name) {
  document.cookie = `${name}=; max-age=0; path=/`;
}

// --- Dates ---

function todayDateString() {
  const d = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateFr(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// --- Loader avec délai minimum d'affichage ---
// Évite l'effet de flash quand les données arrivent quasi instantanément (surtout en local).
// Usage : au chargement de la page, on note `const loadStart = Date.now();`
// puis, quand tout est prêt : `withMinDelay(loadStart, 300, () => { ...révèle la page... });`
function withMinDelay(startTime, minMs, callback) {
  const elapsed = Date.now() - startTime;
  const remaining = minMs - elapsed;
  if (remaining > 0) {
    setTimeout(callback, remaining);
  } else {
    callback();
  }
}
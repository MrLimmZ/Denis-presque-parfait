function buildBaseUrl() {
  const basePath = location.pathname.replace(/\/[^/]*$/, "/");
  return `${location.protocol}//${location.host}${basePath}`;
}

const AppWS = (function () {
  let socket = null;
  const messageQueue = [];
  const listeners = new Map();

  function buildWsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const basePath = location.pathname.replace(/\/[^/]*$/, "/");
    return `${proto}//${location.host}${basePath}ws`;
  }

  function emit(type, data) {
    const set = listeners.get(type);
    if (!set) return;
    set.forEach((cb) => cb(data));
  }

  function connect() {
    socket = new WebSocket(buildWsUrl());

    socket.addEventListener("open", () => {
      while (messageQueue.length > 0) socket.send(messageQueue.shift());
      emit("_open", null);
    });
    socket.addEventListener("close", () => {
      emit("_close", null);
      setTimeout(connect, 2000);
    });
    socket.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      emit(data.type, data);
    });
  }

  function send(dataOrString) {
    const str = typeof dataOrString === "string" ? dataOrString : JSON.stringify(dataOrString);
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(str);
    else messageQueue.push(str);
  }

  function on(type, callback) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
    return () => listeners.get(type).delete(callback);
  }

  connect();

  return { send, on };
})();

function connectWS({
  onParticipants,
  onUnassignedParticipants,
  onCriteria,
  onCriteriaError,
  onAssignmentsList,
  onAssignmentGet,
  onAssignmentForParticipant,
  onAssignmentUpdate,
  onAssignmentError,
  onAssignmentsRandomDone,
  onVotesList,
  onVotesSubmitted,
  onHasVotedToday,
  onVotersForDate,
  onVoterUpdate,
  onSetupStatus,
  onParticipantsError,
  onGameStatus,
  onGameComplete,
  onDbResetDone,
  onServerError,
  onOpen,
  onClose,
} = {}) {
  if (onOpen) AppWS.on("_open", onOpen);
  if (onClose) AppWS.on("_close", onClose);
  if (onParticipants) AppWS.on("participants", (d) => onParticipants(d.list));
  if (onUnassignedParticipants) AppWS.on("participants:unassigned", (d) => onUnassignedParticipants(d.list));
  if (onCriteria) AppWS.on("criteria", (d) => onCriteria(d.list));
  if (onCriteriaError) AppWS.on("criteria:error", (d) => onCriteriaError(d.message));
  if (onAssignmentsList) AppWS.on("assignments:list", (d) => onAssignmentsList(d.month, d.list));
  if (onAssignmentGet) AppWS.on("assignments:get", (d) => onAssignmentGet(d.date, d.assignment));
  if (onAssignmentForParticipant)
    AppWS.on("assignments:get_for_participant", (d) => onAssignmentForParticipant(d.participant_id, d.date));
  if (onAssignmentUpdate)
    AppWS.on("assignments:update", (d) =>
      onAssignmentUpdate(
        d.date,
        d.participant_id,
        d.participant_name,
        d.has_votes,
        d.avatar_icon,
        d.avatar_color,
        d.avatar_image
      )
    );
  if (onAssignmentError) AppWS.on("assignments:error", (d) => onAssignmentError(d.message));
  if (onAssignmentsRandomDone) AppWS.on("assignments:random:done", onAssignmentsRandomDone);
  if (onVotesList) AppWS.on("votes:list", (d) => onVotesList(d.list));
  if (onVotesSubmitted) AppWS.on("votes:submitted", onVotesSubmitted);
  if (onHasVotedToday) AppWS.on("votes:has_voted_today", (d) => onHasVotedToday(d.hasVoted));
  if (onVotersForDate)
    AppWS.on("votes:voters_for_date", (d) => onVotersForDate(d.date, d.target_participant_id, d.voter_ids));
  if (onVoterUpdate)
    AppWS.on("votes:voter_update", (d) => onVoterUpdate(d.date, d.target_participant_id, d.voter_participant_id));
  if (onSetupStatus) AppWS.on("setup:status", (d) => onSetupStatus(d.status));
  if (onParticipantsError) AppWS.on("participants:error", (d) => onParticipantsError(d.message));
  if (onGameStatus) AppWS.on("game:status", (d) => onGameStatus(d.complete, d.results));
  if (onGameComplete) AppWS.on("game:complete", (d) => onGameComplete(d.results));
  if (onDbResetDone) AppWS.on("db:reset:done", onDbResetDone);
  if (onServerError) AppWS.on("server:error", (d) => onServerError(d.message));

  return {
    send: AppWS.send,
    get readyState() {
      return WebSocket.OPEN;
    },
  };
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
function withMinDelay(startTime, minMs, callback) {
  const elapsed = Date.now() - startTime;
  const remaining = minMs - elapsed;
  if (remaining > 0) setTimeout(callback, remaining);
  else callback();
}
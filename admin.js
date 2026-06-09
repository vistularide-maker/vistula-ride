const loginView = document.querySelector("#loginView");
const dashboardView = document.querySelector("#dashboardView");
const loginForm = document.querySelector("#adminLoginForm");
const loginMessage = document.querySelector("#loginMessage");
const adminMessage = document.querySelector("#adminMessage");
const blockMessage = document.querySelector("#blockMessage") || adminMessage;
const bookingsTable = document.querySelector("#bookingsTable");
const blocksTable = document.querySelector("#blocksTable");
const blockForm = document.querySelector("#blockForm");
const logoutButton = document.querySelector("#logoutButton");
const blockDateFromInput = blockForm.querySelector('input[name="dateFrom"]');
const blockDateToInput = blockForm.querySelector('input[name="dateTo"]');
const blockSubmitButton = blockForm.querySelector('button[type="submit"]');

function statusLabel(status) {
  return status === "cancelled" ? "Anulowana" : "Aktywna";
}

function paymentLabel(status) {
  const labels = {
    paid: "Opłacone",
    pending: "Oczekuje",
    failed: "Nieudane",
    refunded: "Zwrot"
  };

  return labels[status] || "Oczekuje";
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function syncBlockDateInputs() {
  blockDateToInput.min = blockDateFromInput.value;

  if (blockDateToInput.value && blockDateFromInput.value && blockDateToInput.value < blockDateFromInput.value) {
    blockDateToInput.value = blockDateFromInput.value;
  }
}

function blockDateLabel(block) {
  if (block.dateFrom && block.dateTo && block.dateFrom !== block.dateTo) {
    return `${escapeHtml(block.dateFrom)}-${escapeHtml(block.dateTo)}`;
  }

  return escapeHtml(block.date || block.dateFrom || "-");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function documentLink(booking) {
  if (!booking.document?.data) {
    return escapeHtml(booking.document?.name || "Brak pliku");
  }

  return `<a href="${escapeHtml(booking.document.data)}" download="${escapeHtml(booking.document.name)}">${escapeHtml(booking.document.name)}</a>`;
}

function renderBookings(bookings) {
  if (!bookings.length) {
    bookingsTable.innerHTML = '<tr><td colspan="9">Brak rezerwacji.</td></tr>';
    return;
  }

  bookingsTable.innerHTML = bookings
    .sort((a, b) => `${b.date} ${b.start}`.localeCompare(`${a.date} ${a.start}`))
    .map((booking) => {
      const cancelled = booking.status === "cancelled";
      return `
        <tr class="${cancelled ? "is-cancelled" : ""}">
          <td><span class="admin-status">${statusLabel(booking.status)}</span></td>
          <td><span class="admin-payment ${booking.paymentStatus === "paid" ? "is-paid" : ""}">${paymentLabel(booking.paymentStatus)}</span></td>
          <td>${escapeHtml(booking.date)}<br>${formatHour(booking.start)}-${formatHour(booking.end)}</td>
          <td>${escapeHtml(booking.package)}<br>${escapeHtml(booking.price || "")} zł</td>
          <td>${escapeHtml(booking.customer?.name || "-")}</td>
          <td>${escapeHtml(booking.customer?.phone || "-")}<br>${escapeHtml(booking.customer?.email || "-")}</td>
          <td>${documentLink(booking)}</td>
          <td>${escapeHtml(new Date(booking.createdAt).toLocaleString("pl-PL"))}</td>
          <td>
            <button class="admin-paid" data-id="${escapeHtml(booking.id)}" type="button" ${cancelled || booking.paymentStatus === "paid" ? "disabled" : ""}>
              Opłacone
            </button>
            <button class="admin-cancel" data-id="${escapeHtml(booking.id)}" type="button" ${cancelled ? "disabled" : ""}>
              Anuluj
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderBlocks(blocks) {
  if (!blocks.length) {
    blocksTable.innerHTML = '<tr><td colspan="6">Brak blokad.</td></tr>';
    return;
  }

  blocksTable.innerHTML = blocks
    .sort((a, b) => `${b.date} ${b.start}`.localeCompare(`${a.date} ${a.start}`))
    .map((block) => {
      const cancelled = block.status === "cancelled";
      return `
        <tr class="${cancelled ? "is-cancelled" : ""}">
          <td><span class="admin-status">${statusLabel(block.status)}</span></td>
          <td>${blockDateLabel(block)}<br>${formatHour(block.start)}-${formatHour(block.end)}</td>
          <td>${escapeHtml(block.bikes)}</td>
          <td>${escapeHtml(block.reason || "-")}</td>
          <td>${escapeHtml(new Date(block.createdAt).toLocaleString("pl-PL"))}</td>
          <td>
            <button class="admin-cancel admin-block-cancel" data-id="${escapeHtml(block.id)}" type="button" ${cancelled ? "disabled" : ""}>
              Usuń blokadę
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadBookings() {
  const response = await fetch("/api/admin/bookings");
  if (response.status === 401) {
    loginView.hidden = false;
    dashboardView.hidden = true;
    return;
  }

  const bookings = await response.json();
  loginView.hidden = true;
  dashboardView.hidden = false;
  renderBookings(bookings);
}

async function loadBlocks() {
  const response = await fetch("/api/admin/blocks");
  if (response.status === 401) {
    loginView.hidden = false;
    dashboardView.hidden = true;
    return;
  }

  renderBlocks(await response.json());
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";

  const data = new FormData(loginForm);
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: data.get("login"),
      password: data.get("password")
    })
  });

  if (!response.ok) {
    const payload = await response.json();
    loginMessage.textContent = payload.message || "Nie udało się zalogować.";
    return;
  }

  loginForm.reset();
  await loadBookings();
  await loadBlocks();
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  dashboardView.hidden = true;
  loginView.hidden = false;
});

bookingsTable.addEventListener("click", async (event) => {
  const paidButton = event.target.closest(".admin-paid");
  if (paidButton) {
    const response = await fetch(`/api/admin/bookings/${encodeURIComponent(paidButton.dataset.id)}/paid`, {
      method: "POST"
    });
    const payload = await response.json();

    if (!response.ok) {
      adminMessage.textContent = payload.message || "Nie udało się oznaczyć płatności.";
      return;
    }

    adminMessage.textContent = "Rezerwacja oznaczona jako opłacona.";
    renderBookings(payload.bookings);
    return;
  }

  const button = event.target.closest(".admin-cancel");
  if (!button) {
    return;
  }

  const confirmed = window.confirm("Anulować tę rezerwację?");
  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/admin/bookings/${encodeURIComponent(button.dataset.id)}/cancel`, {
    method: "POST"
  });
  const payload = await response.json();

  if (!response.ok) {
    adminMessage.textContent = payload.message || "Nie udało się anulować rezerwacji.";
    return;
  }

  adminMessage.textContent = "Rezerwacja została anulowana.";
  renderBookings(payload.bookings);
});

blockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  blockMessage.textContent = "";
  adminMessage.textContent = "";

  const data = new FormData(blockForm);
  const dateFrom = String(data.get("dateFrom") || "");
  const dateTo = String(data.get("dateTo") || dateFrom);

  if (dateTo < dateFrom) {
    blockMessage.textContent = "Data do nie może być wcześniejsza niż Data od.";
    return;
  }

  blockSubmitButton.disabled = true;

  try {
    const response = await fetch("/api/admin/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dateFrom,
        dateTo,
        start: Number(data.get("start")),
        end: Number(data.get("end")),
        bikes: Number(data.get("bikes")),
        reason: data.get("reason")
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      blockMessage.textContent = payload.message || "Nie udało się dodać blokady.";
      return;
    }

    blockForm.reset();
    syncBlockDateInputs();
    blockMessage.textContent = payload.createdCount > 1 ? `Dodano blokady: ${payload.createdCount}.` : "Blokada została dodana.";
    renderBlocks(payload.blocks || []);
  } catch {
    blockMessage.textContent = "Nie udało się połączyć z serwerem. Odśwież panel i spróbuj ponownie.";
  } finally {
    blockSubmitButton.disabled = false;
  }
});

blockDateFromInput.addEventListener("change", syncBlockDateInputs);

blocksTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".admin-block-cancel");
  if (!button) {
    return;
  }

  const confirmed = window.confirm("Usunąć tę blokadę?");
  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/admin/blocks/${encodeURIComponent(button.dataset.id)}/cancel`, {
    method: "POST"
  });
  const payload = await response.json();

  if (!response.ok) {
    adminMessage.textContent = payload.message || "Nie udało się usunąć blokady.";
    return;
  }

  adminMessage.textContent = "Blokada została usunięta.";
  renderBlocks(payload.blocks);
});

loadBookings().then(loadBlocks);

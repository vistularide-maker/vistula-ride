const loginView = document.querySelector("#loginView");
const dashboardView = document.querySelector("#dashboardView");
const loginForm = document.querySelector("#adminLoginForm");
const loginMessage = document.querySelector("#loginMessage");
const adminMessage = document.querySelector("#adminMessage");
const bookingsTable = document.querySelector("#bookingsTable");
const logoutButton = document.querySelector("#logoutButton");

function statusLabel(status) {
  return status === "cancelled" ? "Anulowana" : "Aktywna";
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
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
    bookingsTable.innerHTML = '<tr><td colspan="8">Brak rezerwacji.</td></tr>';
    return;
  }

  bookingsTable.innerHTML = bookings
    .sort((a, b) => `${b.date} ${b.start}`.localeCompare(`${a.date} ${a.start}`))
    .map((booking) => {
      const cancelled = booking.status === "cancelled";
      return `
        <tr class="${cancelled ? "is-cancelled" : ""}">
          <td><span class="admin-status">${statusLabel(booking.status)}</span></td>
          <td>${escapeHtml(booking.date)}<br>${formatHour(booking.start)}-${formatHour(booking.end)}</td>
          <td>${escapeHtml(booking.package)}<br>${escapeHtml(booking.price || "")} zł</td>
          <td>${escapeHtml(booking.customer?.name || "-")}</td>
          <td>${escapeHtml(booking.customer?.phone || "-")}<br>${escapeHtml(booking.customer?.email || "-")}</td>
          <td>${documentLink(booking)}</td>
          <td>${escapeHtml(new Date(booking.createdAt).toLocaleString("pl-PL"))}</td>
          <td>
            <button class="admin-cancel" data-id="${escapeHtml(booking.id)}" type="button" ${cancelled ? "disabled" : ""}>
              Anuluj
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
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  dashboardView.hidden = true;
  loginView.hidden = false;
});

bookingsTable.addEventListener("click", async (event) => {
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

loadBookings();

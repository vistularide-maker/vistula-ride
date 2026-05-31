const form = document.querySelector("#bookingForm");
const rentalPrice = document.querySelector("#rentalPrice");
const message = document.querySelector("#formMessage");
const dateInput = form.querySelector('input[name="date"]');
const timeSelect = form.querySelector('select[name="time"]');
const availabilityMessage = document.querySelector("#availabilityMessage");
const fleetSize = 4;
const storageKey = "vistulaRideBookings";
let bookingsCache = [];

document.querySelectorAll('a[href="#bookingForm"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelector("#bookingForm").scrollIntoView({ behavior: "smooth", block: "start" });
    history.pushState(null, "", "#bookingForm");
  });
});

const today = new Date();
today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
dateInput.min = today.toISOString().slice(0, 10);
dateInput.value = dateInput.min;

function selectedPackage() {
  return form.querySelector('input[name="package"]:checked');
}

function packageDuration() {
  return Number(selectedPackage().dataset.duration);
}

function timeToHour(time) {
  return Number(time.split(":")[0]);
}

function bookingWindow(time) {
  const start = timeToHour(time);
  return {
    start,
    end: start + packageDuration()
  };
}

function readStoredBookings() {
  try {
    if (window.localStorage) {
      return JSON.parse(window.localStorage.getItem(storageKey)) || [];
    }
  } catch {
    return [];
  }

  return [];
}

function saveStoredBookings(bookings) {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(storageKey, JSON.stringify(bookings));
    }
  } catch {
    return;
  }
}

async function syncBookings() {
  try {
    const response = await fetch("/api/bookings");
    if (!response.ok) {
      throw new Error("Bookings API unavailable");
    }
    bookingsCache = await response.json();
    saveStoredBookings(bookingsCache);
  } catch {
    bookingsCache = readStoredBookings();
  }

  refreshAvailability();
}

async function createBooking(booking) {
  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(booking)
    });
    const payload = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        message: payload.message || "Wybrany termin nie jest już dostępny."
      };
    }

    bookingsCache = payload.bookings;
    saveStoredBookings(bookingsCache);
    return { ok: true };
  } catch {
    const available = availableBikes(booking.date, `${String(booking.start).padStart(2, "0")}:00`);
    if (available < booking.bikes) {
      return {
        ok: false,
        message: "Wybrany termin nie jest już dostępny."
      };
    }

    bookingsCache = [
      ...bookingsCache,
      {
        ...booking,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      }
    ];
    saveStoredBookings(bookingsCache);
    return { ok: true };
  }
}

function overlaps(first, second) {
  return first.start < second.end && second.start < first.end;
}

function availableBikes(date, time) {
  if (!date || !time) {
    return fleetSize;
  }

  const currentWindow = bookingWindow(time);
  const reserved = bookingsCache
    .filter((booking) => booking.status !== "cancelled")
    .filter((booking) => booking.date === date)
    .filter((booking) => overlaps(currentWindow, booking))
    .reduce((sum, booking) => sum + Number(booking.bikes), 0);

  return Math.max(0, fleetSize - reserved);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function uploadedDocument(formData) {
  const file = formData.get("document");
  if (!(file instanceof File) || !file.name) {
    return null;
  }

  return {
    name: file.name,
    type: file.type,
    size: file.size,
    data: await readFileAsDataUrl(file)
  };
}

function isPastTime(date, time) {
  if (!date || !time || date !== dateInput.min) {
    return false;
  }

  const now = new Date();
  return timeToHour(time) <= now.getHours();
}

function refreshAvailability() {
  const selectedTime = timeSelect.value;
  const selectedDate = dateInput.value;
  const requestedBikes = 1;
  const duration = packageDuration();

  timeSelect.setCustomValidity("");

  [...timeSelect.options].forEach((option) => {
    if (!option.value) {
      return;
    }

    const start = timeToHour(option.value);
    const closesAt = 20;
    const enoughTimeBeforeClosing = start + duration <= closesAt;
    const allDayStartsCorrectly = selectedPackage().value !== "Cały dzień" || option.value === "09:00";
    const enoughBikes = availableBikes(selectedDate, option.value) >= requestedBikes;
    const inFuture = !isPastTime(selectedDate, option.value);
    option.disabled = !enoughTimeBeforeClosing || !allDayStartsCorrectly || !enoughBikes || !inFuture;
  });

  if (selectedTime && timeSelect.selectedOptions[0]?.disabled) {
    timeSelect.value = "";
  }

  if (!timeSelect.value) {
    availabilityMessage.textContent = "Wybierz termin i godzinę, aby sprawdzić dostępność roweru.";
    return;
  }

  const available = availableBikes(selectedDate, timeSelect.value);
  if (available < requestedBikes) {
    timeSelect.setCustomValidity("Brak wystarczającej liczby rowerów w wybranym terminie.");
    availabilityMessage.textContent = `W tej godzinie dostępne: ${available} z ${fleetSize} rowerów. Wybierz inną godzinę lub mniejszą liczbę rowerów.`;
    return;
  }

  const reservationWindow = bookingWindow(timeSelect.value);
  availabilityMessage.textContent = `Dostępne: ${available} z ${fleetSize} rowerów. Rezerwacja obejmie godziny ${timeSelect.value}-${String(reservationWindow.end).padStart(2, "0")}:00.`;
}

function updateTotal() {
  const pack = selectedPackage();
  const rental = Number(pack.dataset.price);
  rentalPrice.textContent = `${rental} zł`;
  refreshAvailability();
}

form.addEventListener("input", updateTotal);
form.addEventListener("change", updateTotal);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) {
    return;
  }

  const data = new FormData(form);
  const pack = selectedPackage();
  const bikes = 1;
  const time = data.get("time");
  const date = data.get("date");
  const available = availableBikes(date, time);
  const stripeLink = pack.dataset.stripeLink;

  if (!stripeLink) {
    message.textContent = "Brakuje linku płatności Stripe dla wybranego pakietu. Dodaj link w konfiguracji pakietu.";
    return;
  }

  if (available < bikes) {
    timeSelect.setCustomValidity("Brak wystarczającej liczby rowerów w wybranym terminie.");
    form.reportValidity();
    refreshAvailability();
    return;
  }

  const reservationWindow = bookingWindow(time);
  const document = await uploadedDocument(data);

  const bookingResult = await createBooking({
    date,
    start: reservationWindow.start,
    end: reservationWindow.end,
    bikes,
    package: pack.value,
    price: Number(pack.dataset.price),
    customer: {
      name: String(data.get("name") || ""),
      phone: String(data.get("phone") || ""),
      email: String(data.get("email") || "")
    },
    document
  });

  if (!bookingResult.ok) {
    timeSelect.setCustomValidity(bookingResult.message);
    form.reportValidity();
    await syncBookings();
    return;
  }

  message.textContent = `Dziękujemy, ${data.get("name")}! Rezerwacja na ${date} o ${time} została przyjęta. Przekierowujemy do płatności Stripe.`;
  window.location.href = stripeLink;
  form.reset();
  form.querySelector('input[value="1 godzina"]').checked = true;
  dateInput.value = dateInput.min;
  updateTotal();
});

bookingsCache = readStoredBookings();
updateTotal();
syncBookings();

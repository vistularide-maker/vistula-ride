const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const root = __dirname;
const bookingsFile = path.join(root, "bookings.json");
const port = Number(process.env.PORT || 4173);
const fleetSize = 4;
const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "vistula2026";
const adminSession = process.env.ADMIN_SESSION || randomUUID();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

async function readBookings() {
  try {
    return JSON.parse(await fs.readFile(bookingsFile, "utf8"));
  } catch {
    return [];
  }
}

async function writeBookings(bookings) {
  await fs.writeFile(bookingsFile, JSON.stringify(bookings, null, 2));
}

function overlaps(first, second) {
  return first.start < second.end && second.start < first.end;
}

function availableBikes(bookings, candidate) {
  const reserved = bookings
    .filter((booking) => booking.status !== "cancelled")
    .filter((booking) => booking.date === candidate.date)
    .filter((booking) => overlaps(candidate, booking))
    .reduce((sum, booking) => sum + Number(booking.bikes), 0);

  return Math.max(0, fleetSize - reserved);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function publicBooking(booking) {
  return {
    id: booking.id,
    date: booking.date,
    start: booking.start,
    end: booking.end,
    bikes: booking.bikes,
    package: booking.package,
    status: booking.status || "active"
  };
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function isAdmin(req) {
  return parseCookies(req).vistulaAdmin === adminSession;
}

function requireAdmin(req, res) {
  if (isAdmin(req)) {
    return true;
  }

  sendJson(res, 401, { message: "Brak dostępu do panelu admina." });
  return false;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/bookings" && req.method === "GET") {
      const bookings = await readBookings();
      sendJson(res, 200, bookings.filter((booking) => booking.status !== "cancelled").map(publicBooking));
      return;
    }

    if (req.url === "/api/bookings" && req.method === "POST") {
      const booking = await readJson(req);
      const bookings = await readBookings();
      const candidate = {
        id: randomUUID(),
        date: String(booking.date || ""),
        start: Number(booking.start),
        end: Number(booking.end),
        bikes: Number(booking.bikes),
        package: String(booking.package || ""),
        price: Number(booking.price || 0),
        paymentProvider: "stripe",
        paymentStatus: "pending",
        status: "active",
        customer: {
          name: String(booking.customer?.name || ""),
          phone: String(booking.customer?.phone || ""),
          email: String(booking.customer?.email || "")
        },
        document: booking.document
          ? {
              name: String(booking.document.name || ""),
              type: String(booking.document.type || ""),
              size: Number(booking.document.size || 0),
              data: String(booking.document.data || "")
            }
          : null,
        createdAt: new Date().toISOString()
      };

      if (
        !candidate.date ||
        !candidate.start ||
        !candidate.end ||
        candidate.end <= candidate.start ||
        candidate.bikes < 1 ||
        candidate.bikes > fleetSize ||
        !candidate.customer.name ||
        !candidate.customer.phone ||
        !candidate.customer.email
      ) {
        sendJson(res, 400, { message: "Nieprawidłowe dane rezerwacji." });
        return;
      }

      if (availableBikes(bookings, candidate) < candidate.bikes) {
        sendJson(res, 409, { message: "Brak wystarczającej liczby rowerów w wybranym terminie." });
        return;
      }

      const nextBookings = [...bookings, candidate];
      await writeBookings(nextBookings);
      sendJson(res, 201, { booking: candidate, bookings: nextBookings });
      return;
    }

    if (req.url === "/api/admin/login" && req.method === "POST") {
      const credentials = await readJson(req);
      if (credentials.login !== adminUser || credentials.password !== adminPassword) {
        sendJson(res, 401, { message: "Nieprawidłowy login lub hasło." });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": `vistulaAdmin=${encodeURIComponent(adminSession)}; HttpOnly; SameSite=Lax; Path=/`
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === "/api/admin/logout" && req.method === "POST") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": "vistulaAdmin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === "/api/admin/bookings" && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }

      sendJson(res, 200, await readBookings());
      return;
    }

    const cancelMatch = req.url.match(/^\/api\/admin\/bookings\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }

      const bookings = await readBookings();
      const id = decodeURIComponent(cancelMatch[1]);
      const nextBookings = bookings.map((booking) =>
        booking.id === id
          ? {
              ...booking,
              status: "cancelled",
              cancelledAt: new Date().toISOString()
            }
          : booking
      );

      if (!bookings.some((booking) => booking.id === id)) {
        sendJson(res, 404, { message: "Nie znaleziono rezerwacji." });
        return;
      }

      await writeBookings(nextBookings);
      sendJson(res, 200, { ok: true, bookings: nextBookings });
      return;
    }

    await serveStatic(req, res);
  } catch {
    sendJson(res, 500, { message: "Wystąpił błąd serwera." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Vistula Ride działa na porcie ${port}`);
});

const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const root = __dirname;
const bookingsFile = path.join(root, "bookings.json");
const blocksFile = path.join(root, "blocks.json");
const port = Number(process.env.PORT || 4173);
const fleetSize = 4;
const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "vistula2026";
const adminSession = process.env.ADMIN_SESSION || randomUUID();
const cancellationReasons = new Set(["brak płatności", "brak dokumentu", "błąd po naszej stronie"]);
let dbPool = null;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

async function readBookings() {
  if (dbPool) {
    const result = await dbPool.query(`
      SELECT id, date, start_hour, end_hour, bikes, package, price, payment_provider,
             payment_status, status, customer, document, created_at, cancelled_at, cancellation_reason
      FROM bookings
      ORDER BY created_at DESC
    `);

    return result.rows.map((booking) => ({
      id: booking.id,
      date: booking.date,
      start: Number(booking.start_hour),
      end: Number(booking.end_hour),
      bikes: Number(booking.bikes),
      package: booking.package,
      price: Number(booking.price),
      paymentProvider: booking.payment_provider,
      paymentStatus: booking.payment_status,
      status: booking.status,
      customer: booking.customer,
      document: booking.document,
      createdAt: booking.created_at,
      cancelledAt: booking.cancelled_at,
      cancellationReason: booking.cancellation_reason || ""
    }));
  }

  try {
    return JSON.parse(await fs.readFile(bookingsFile, "utf8"));
  } catch {
    return [];
  }
}

async function writeBookings(bookings) {
  if (dbPool) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM bookings");

      for (const booking of bookings) {
        await client.query(
          `
            INSERT INTO bookings (
              id, date, start_hour, end_hour, bikes, package, price, payment_provider,
              payment_status, status, customer, document, created_at, cancelled_at, cancellation_reason
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15)
          `,
          [
            booking.id,
            booking.date,
            booking.start,
            booking.end,
            booking.bikes,
            booking.package,
            booking.price || 0,
            booking.paymentProvider || "stripe",
            booking.paymentStatus || "pending",
            booking.status || "active",
            JSON.stringify(booking.customer || {}),
            JSON.stringify(booking.document || null),
            booking.createdAt || new Date().toISOString(),
            booking.cancelledAt || null,
            booking.cancellationReason || ""
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  await fs.writeFile(bookingsFile, JSON.stringify(bookings, null, 2));
}

async function readBlocks() {
  if (dbPool) {
    const result = await dbPool.query(`
      SELECT id, date, date_from, date_to, start_hour, end_hour, bikes, reason, status, created_at, cancelled_at
      FROM blocks
      ORDER BY created_at DESC
    `);

    return normalizeBlocks(result.rows.map((block) => ({
      id: block.id,
      date: block.date_from || block.date,
      dateFrom: block.date_from || block.date,
      dateTo: block.date_to || block.date_from || block.date,
      start: Number(block.start_hour),
      end: Number(block.end_hour),
      bikes: Number(block.bikes),
      reason: block.reason,
      status: block.status,
      createdAt: block.created_at,
      cancelledAt: block.cancelled_at
    })));
  }

  try {
    return normalizeBlocks(JSON.parse(await fs.readFile(blocksFile, "utf8")));
  } catch {
    return [];
  }
}

async function writeBlocks(blocks) {
  if (dbPool) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM blocks");

      for (const block of blocks) {
        const dateFrom = block.dateFrom || block.date;
        const dateTo = block.dateTo || dateFrom;
        await client.query(
          `
            INSERT INTO blocks (id, date, date_from, date_to, start_hour, end_hour, bikes, reason, status, created_at, cancelled_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            block.id,
            dateFrom,
            dateFrom,
            dateTo,
            block.start,
            block.end,
            block.bikes,
            block.reason || "",
            block.status || "active",
            block.createdAt || new Date().toISOString(),
            block.cancelledAt || null
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  await fs.writeFile(blocksFile, JSON.stringify(blocks, null, 2));
}

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    return;
  }

  const { Pool } = require("pg");
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
  });

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_hour INTEGER NOT NULL,
      end_hour INTEGER NOT NULL,
      bikes INTEGER NOT NULL DEFAULT 1,
      package TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      payment_provider TEXT NOT NULL DEFAULT 'stripe',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'active',
      customer JSONB NOT NULL DEFAULT '{}'::jsonb,
      document JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cancelled_at TIMESTAMPTZ
    )
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_hour INTEGER NOT NULL,
      end_hour INTEGER NOT NULL,
      bikes INTEGER NOT NULL DEFAULT 1,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cancelled_at TIMESTAMPTZ
    )
  `);

  await dbPool.query("ALTER TABLE blocks ADD COLUMN IF NOT EXISTS date_from TEXT");
  await dbPool.query("ALTER TABLE blocks ADD COLUMN IF NOT EXISTS date_to TEXT");
  await dbPool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NOT NULL DEFAULT ''");
  await dbPool.query("UPDATE blocks SET date_from = date WHERE date_from IS NULL");
  await dbPool.query("UPDATE blocks SET date_to = COALESCE(date_to, date_from, date) WHERE date_to IS NULL");
}

function overlaps(first, second) {
  return first.start < second.end && second.start < first.end;
}

function isActiveOnDate(item, date) {
  const dateFrom = item.dateFrom || item.date;
  const dateTo = item.dateTo || dateFrom;
  return dateFrom <= date && date <= dateTo;
}

function availableBikes(bookings, candidate) {
  const reserved = bookings
    .filter((booking) => booking.status !== "cancelled")
    .filter((booking) => isActiveOnDate(booking, candidate.date))
    .filter((booking) => overlaps(candidate, booking))
    .reduce((sum, booking) => sum + Number(booking.bikes), 0);

  return Math.max(0, fleetSize - reserved);
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function parseDateValue(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateRange(from, to) {
  const start = parseDateValue(from);
  const end = parseDateValue(to);

  if (!start || !end || start > end) {
    return [];
  }

  const dates = [];
  const current = new Date(start);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function normalizeBlock(block) {
  const dateFrom = block.dateFrom || block.date;
  const dateTo = block.dateTo || dateFrom;

  return {
    ...block,
    date: dateFrom,
    dateFrom,
    dateTo
  };
}

function nextDateValue(date) {
  const parsed = parseDateValue(date);
  if (!parsed) {
    return "";
  }

  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function normalizeBlocks(blocks) {
  const prepared = blocks.map(normalizeBlock);
  const ranges = prepared.filter((block) => block.dateFrom !== block.dateTo);
  const singleDayBlocks = prepared.filter((block) => block.dateFrom === block.dateTo);
  const groups = new Map();

  singleDayBlocks.forEach((block) => {
    const key = [
      block.start,
      block.end,
      block.bikes,
      block.reason || "",
      block.status || "active",
      block.createdAt || "",
      block.cancelledAt || ""
    ].join("|");

    groups.set(key, [...(groups.get(key) || []), block]);
  });

  const merged = [];
  groups.forEach((group) => {
    group.sort((first, second) => first.dateFrom.localeCompare(second.dateFrom));

    let current = null;
    group.forEach((block) => {
      if (!current || nextDateValue(current.dateTo) !== block.dateFrom) {
        current = { ...block };
        merged.push(current);
        return;
      }

      current.dateTo = block.dateTo;
    });
  });

  return [...ranges, ...merged];
}

function isValidBookingWindow(booking) {
  const allowedDurations = [1, 3, 11];
  const duration = Number(booking.end) - Number(booking.start);

  return (
    Number(booking.start) >= 9 &&
    Number(booking.end) <= 20 &&
    allowedDurations.includes(duration) &&
    (booking.package !== "Cały dzień" || (Number(booking.start) === 9 && Number(booking.end) === 20))
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getMailFrom() {
  const from = process.env.MAIL_FROM || "";

  if (!from || from.includes("<") || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    return from;
  }

  const emailMatch = from.match(/([^\s@]+@[^\s@]+\.[^\s@]+)$/);
  if (!emailMatch) {
    return from;
  }

  const name = from.slice(0, emailMatch.index).trim();
  return name ? `${name} <${emailMatch[1]}>` : emailMatch[1];
}

function reservationEmailHtml(booking) {
  const mapUrl = "https://www.google.com/maps/dir//Na+Wi%C5%9Blanej+Skarpie,+Widokowa+12,+87-125+Stajenczynki";
  return `
    <div style="font-family:Arial,sans-serif;color:#02111F;line-height:1.5">
      <h1 style="margin:0 0 16px">Potwierdzenie rezerwacji Vistula Ride</h1>
      <p>Dzień dobry ${escapeHtml(booking.customer.name)},</p>
      <p>Przyjęliśmy Twoją rezerwację roweru elektrycznego.</p>
      <table style="border-collapse:collapse;margin:20px 0;width:100%;max-width:560px">
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Data</strong></td><td style="padding:8px;border:1px solid #d8dde5">${escapeHtml(booking.date)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Godzina</strong></td><td style="padding:8px;border:1px solid #d8dde5">${formatHour(booking.start)}-${formatHour(booking.end)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Pakiet</strong></td><td style="padding:8px;border:1px solid #d8dde5">${escapeHtml(booking.package)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Płatność online</strong></td><td style="padding:8px;border:1px solid #d8dde5">${escapeHtml(booking.price)} zł</td></tr>
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Kaucja zwrotna</strong></td><td style="padding:8px;border:1px solid #d8dde5">300 zł gotówką przy odbiorze</td></tr>
      </table>
      <p><strong>Odbiór:</strong><br>Na Wiślanej Skarpie, Widokowa 12, 87-125 Stajenczynki</p>
      <p><a href="${mapUrl}" style="color:#F47A00;font-weight:bold">Wyznacz trasę w Google Maps</a></p>
      <p>Do zobaczenia na trasie,<br>Vistula Ride</p>
    </div>
  `;
}

function cancellationEmailHtml(booking) {
  return `
    <div style="font-family:Arial,sans-serif;color:#02111F;line-height:1.5">
      <h1 style="margin:0 0 16px">Anulowanie rezerwacji Vistula Ride</h1>
      <p>Dzień dobry ${escapeHtml(booking.customer.name)},</p>
      <p>Twoja rezerwacja roweru elektrycznego została anulowana.</p>
      <table style="border-collapse:collapse;margin:20px 0;width:100%;max-width:560px">
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Data</strong></td><td style="padding:8px;border:1px solid #d8dde5">${escapeHtml(booking.date)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Godzina</strong></td><td style="padding:8px;border:1px solid #d8dde5">${formatHour(booking.start)}-${formatHour(booking.end)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Pakiet</strong></td><td style="padding:8px;border:1px solid #d8dde5">${escapeHtml(booking.package)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #d8dde5"><strong>Powód anulacji</strong></td><td style="padding:8px;border:1px solid #d8dde5">${escapeHtml(booking.cancellationReason)}</td></tr>
      </table>
      <p>Jeśli płatność została już wykonana, pieniądze zostaną zwrócone na rachunek użyty do płatności.</p>
      <p>W razie pytań odpisz na tę wiadomość lub skontaktuj się z nami: rezerwacje@vistularide.pl.</p>
      <p>Vistula Ride</p>
    </div>
  `;
}

async function sendEmail({ to, subject, html }) {
  const from = getMailFrom();

  if (!process.env.RESEND_API_KEY || !from) {
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend error ${response.status}: ${body}`);
  }
}

async function sendCancellationEmail(booking) {
  if (!booking.customer?.email) {
    return;
  }

  await sendEmail({
    to: booking.customer.email,
    subject: `Anulowanie rezerwacji Vistula Ride: ${booking.date}, ${formatHour(booking.start)}`,
    html: cancellationEmailHtml(booking)
  });
  console.log(`Wysłano mail anulowania: klient ${booking.customer.email}`);
}

async function sendReservationEmails(booking) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const customerSubject = `Rezerwacja Vistula Ride: ${booking.date}, ${formatHour(booking.start)}`;
  const adminSubject = `Nowa rezerwacja: ${booking.date}, ${formatHour(booking.start)}`;

  const messages = [
    {
      label: `klient ${booking.customer.email}`,
      to: booking.customer.email,
      subject: customerSubject,
      html: reservationEmailHtml(booking)
    }
  ];

  if (adminEmail) {
    messages.push({
      label: `admin ${adminEmail}`,
      to: adminEmail,
      subject: adminSubject,
      html: `
        ${reservationEmailHtml(booking)}
        <hr>
        <p><strong>Klient:</strong> ${escapeHtml(booking.customer.name)}</p>
        <p><strong>Telefon:</strong> ${escapeHtml(booking.customer.phone)}</p>
        <p><strong>E-mail:</strong> ${escapeHtml(booking.customer.email)}</p>
      `
    });
  }

  const results = await Promise.allSettled(messages.map((message) => sendEmail(message)));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      console.log(`Wysłano mail rezerwacji: ${messages[index].label}`);
    } else {
      console.warn(`Nie udało się wysłać maila rezerwacji: ${messages[index].label}:`, result.reason.message);
    }
  });
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

function publicBlock(block) {
  return {
    id: block.id,
    date: block.date,
    dateFrom: block.dateFrom || block.date,
    dateTo: block.dateTo || block.dateFrom || block.date,
    start: block.start,
    end: block.end,
    bikes: block.bikes,
    package: "Blokada admina",
    status: block.status || "active",
    type: "block"
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
  const cleanRoutes = {
    "/": "/index.html",
    "/admin": "/admin.html",
    "/VARUNM26-2": "/VARUNM26-2.html",
    "/varunm26-2": "/VARUNM26-2.html",
    "/regulamin": "/regulamin.html",
    "/polityka-prywatnosci": "/polityka-prywatnosci.html"
  };
  const requested = cleanRoutes[url.pathname] || decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const headers = { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" };
    if (requested === "/admin.html" || requested === "/admin.js" || requested === "/script.js") {
      headers["Cache-Control"] = "no-store";
    }
    res.writeHead(200, headers);
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
      const blocks = await readBlocks();
      sendJson(res, 200, [
        ...bookings.filter((booking) => booking.status !== "cancelled").map(publicBooking),
        ...blocks.filter((block) => block.status !== "cancelled").map(publicBlock)
      ]);
      return;
    }

    if (req.url === "/api/bookings" && req.method === "POST") {
      const booking = await readJson(req);
      const bookings = await readBookings();
      const blocks = await readBlocks();
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
        !candidate.customer.email ||
        !isValidBookingWindow(candidate)
      ) {
        sendJson(res, 400, { message: "Nieprawidłowe dane rezerwacji." });
        return;
      }

      if (availableBikes([...bookings, ...blocks], candidate) < candidate.bikes) {
        sendJson(res, 409, { message: "Brak wystarczającej liczby rowerów w wybranym terminie." });
        return;
      }

      const nextBookings = [...bookings, candidate];
      await writeBookings(nextBookings);
      sendReservationEmails(candidate).catch((error) => {
        console.warn("Nie udało się wysłać maila rezerwacji:", error.message);
      });
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

    if (req.url === "/api/admin/blocks" && req.method === "GET") {
      if (!requireAdmin(req, res)) {
        return;
      }

      sendJson(res, 200, await readBlocks());
      return;
    }

    if (req.url === "/api/admin/blocks" && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }

      const payload = await readJson(req);
      const dateFrom = String(payload.dateFrom || payload.date || "");
      const dateTo = String(payload.dateTo || payload.date || dateFrom);
      const dates = dateRange(dateFrom, dateTo);
      const template = {
        start: Number(payload.start),
        end: Number(payload.end),
        bikes: Number(payload.bikes),
        reason: String(payload.reason || ""),
        status: "active",
        createdAt: new Date().toISOString()
      };

      if (
        !dates.length ||
        dates.length > 90 ||
        !template.start ||
        !template.end ||
        template.end <= template.start ||
        template.start < 8 ||
        template.end > 20 ||
        template.bikes < 1 ||
        template.bikes > fleetSize
      ) {
        sendJson(res, 400, { message: "Nieprawidłowe dane blokady." });
        return;
      }

      const bookings = await readBookings();
      const blocks = await readBlocks();
      const unavailableDate = dates.find(
        (date) => availableBikes([...bookings, ...blocks], { ...template, date }) < template.bikes
      );

      if (unavailableDate) {
        sendJson(res, 409, { message: `W dniu ${unavailableDate} nie ma tylu wolnych rowerów do zablokowania.` });
        return;
      }

      const block = {
        ...template,
        id: randomUUID(),
        date: dateFrom,
        dateFrom,
        dateTo
      };
      const nextBlocks = [...blocks, block];
      await writeBlocks(nextBlocks);
      sendJson(res, 201, { block, createdCount: 1, daysCount: dates.length, blocks: nextBlocks });
      return;
    }

    const blockCancelMatch = req.url.match(/^\/api\/admin\/blocks\/([^/]+)\/cancel$/);
    if (blockCancelMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }

      const blocks = await readBlocks();
      const id = decodeURIComponent(blockCancelMatch[1]);
      const nextBlocks = blocks.map((block) =>
        block.id === id
          ? {
              ...block,
              status: "cancelled",
              cancelledAt: new Date().toISOString()
            }
          : block
      );

      if (!blocks.some((block) => block.id === id)) {
        sendJson(res, 404, { message: "Nie znaleziono blokady." });
        return;
      }

      await writeBlocks(nextBlocks);
      sendJson(res, 200, { ok: true, blocks: nextBlocks });
      return;
    }

    const cancelMatch = req.url.match(/^\/api\/admin\/bookings\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }

      const payload = await readJson(req);
      const reason = String(payload.reason || "").trim();
      if (!cancellationReasons.has(reason)) {
        sendJson(res, 400, { message: "Wybierz prawidłowy powód anulacji." });
        return;
      }

      const bookings = await readBookings();
      const id = decodeURIComponent(cancelMatch[1]);
      const booking = bookings.find((item) => item.id === id);

      if (!booking) {
        sendJson(res, 404, { message: "Nie znaleziono rezerwacji." });
        return;
      }

      const cancelledAt = new Date().toISOString();
      const cancelledBooking = {
        ...booking,
        status: "cancelled",
        cancelledAt,
        cancellationReason: reason
      };
      const nextBookings = bookings.map((booking) =>
        booking.id === id
          ? cancelledBooking
          : booking
      );

      await writeBookings(nextBookings);
      sendCancellationEmail(cancelledBooking).catch((error) => {
        console.warn("Nie udało się wysłać maila anulowania:", error.message);
      });
      sendJson(res, 200, { ok: true, bookings: nextBookings });
      return;
    }

    const paidMatch = req.url.match(/^\/api\/admin\/bookings\/([^/]+)\/paid$/);
    if (paidMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) {
        return;
      }

      const bookings = await readBookings();
      const id = decodeURIComponent(paidMatch[1]);
      const nextBookings = bookings.map((booking) =>
        booking.id === id
          ? {
              ...booking,
              paymentStatus: "paid",
              paidAt: new Date().toISOString()
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

initDatabase()
  .then(() => {
    server.listen(port, "0.0.0.0", () => {
      const storage = dbPool ? "Postgres" : "bookings.json";
      console.log(`Vistula Ride działa na porcie ${port}. Zapis: ${storage}`);
      console.log(
        `E-mail: ${
          process.env.RESEND_API_KEY && getMailFrom()
            ? `skonfigurowany (${getMailFrom()})`
            : "nie skonfigurowany"
        }`
      );
    });
  })
  .catch((error) => {
    console.error("Nie udało się uruchomić bazy danych:", error);
    process.exit(1);
  });

// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Resend } from "resend";

dotenv.config();

const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://bethesda-mini-library.onrender.com",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


app.use(express.json());

/* ===============================
   CONFIG / CONSTANTS
================================ */

const BETHESDA_LOGO =
  "https://res.cloudinary.com/towson008/image/upload/v1765341466/tp1aouaicde3zpykntkn.png";

const PICKUP_INFO_HTML = `
  <div style="margin-top:16px; padding:12px; background:#003366; border-radius:6px;">
    <p style="margin:0;"><strong>📍 Pickup Location</strong></p>
    <p style="margin:4px 0;">3310 Schmon Parkway, Thorold, ON, L2V 4Y6</p>
    <p style="margin:8px 0 0;">
      <strong>🕒 Pickup Hours</strong><br />
      Monday – Friday: 9:00 AM – 4:00 PM <br/>
      Business Days Only
    </p>
  </div>
`;

/* ===============================
   RESEND SETUP
================================ */

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail({ to, subject, html }) {
  const from =
    process.env.RESEND_FROM ||
    "Bethesda Lending Library <no-reply@bethesdalendinglibrary.com>";

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error("Resend error:", error);
    throw error;
  }

  return data;
}

/* ===============================
   EMAIL TEMPLATE WRAPPER
================================ */

function renderBrandedEmail({ title, content, showPickupInfo = false }) {
  return `
    <div style="background:#f8fafc; padding:24px; font-family:Arial, sans-serif;">
      <div style="max-width:600px; margin:auto; border-radius:8px; overflow:hidden;">
        
        <!-- Header -->
        <div style="background:#003366; padding:20px; text-align:center;">
          <img src="${BETHESDA_LOGO}" alt="Bethesda Toy Lending Library" style="max-width:160px;" />
        </div>

        <!-- Body -->
        <div style="padding:24px; color:#1f2937;">
          <h2 style="color:#003366;">${title}</h2>
          ${content}
          ${showPickupInfo ? PICKUP_INFO_HTML : ""}
        </div>

        <!-- Footer -->
        <div style="background:#003366; padding:16px; font-size:12px; text-align:center; color:#ffffff;">
          <p style="margin:0;">Bethesda Toy Lending Library</p>
          <p style="margin:4px 0;">© 2025 Bethesda Services</p>
        </div>

      </div>
    </div>
  `;
}

/* ======================================================
   ROUTE: Reservation Created
====================================================== */
app.post("/email/reservation-created", async (req, res) => {
  try {
    const {
      parentEmail,
      parentName,
      childName,
      itemName,
      preferredDay,
      note,
    } = req.body;

    if (!parentEmail || !itemName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pickupLine = preferredDay
      ? `Preferred pick-up day: <strong>${preferredDay}</strong>.`
      : "We will contact you with pick-up details soon.";

    await sendEmail({
      to: parentEmail,
      subject: `Reservation received for "${itemName}"`,
      html: renderBrandedEmail({
        title: "Reservation Received",
        showPickupInfo: false,
        content: `
          <p>Hi ${parentName || "there"},</p>
          <p>
            We have received your reservation for
            <strong>${itemName}</strong>
            ${childName ? `for ${childName}` : ""}.
          </p>
          <p>${pickupLine}</p>
          ${
            note
              ? `<p><strong>Your note:</strong><br />${String(note)
                  .replace(/\n/g, "<br />")
                  .trim()}</p>`
              : ""
          }
          <p>
            We will send another email when this toy is
            <strong>ready for pickup</strong>.
          </p>
        `,
      }),
    });

    if (process.env.ADMIN_EMAIL) {
      await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: `New reservation: "${itemName}"`,
        html: `
          <h3>New Reservation</h3>
          <p><strong>Parent:</strong> ${parentName || "N/A"} (${parentEmail})</p>
          <p><strong>Child:</strong> ${childName || "N/A"}</p>
          <p><strong>Item:</strong> ${itemName}</p>
          <p><strong>Preferred pickup:</strong> ${preferredDay || "N/A"}</p>
        `,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Reservation email error:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

/* ======================================================
   ROUTE: Waitlist Created
====================================================== */
app.post("/email/waitlist-created", async (req, res) => {
  try {
    const { parentEmail, parentName, childName, itemName } = req.body;

    if (!parentEmail || !itemName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await sendEmail({
      to: parentEmail,
      subject: `Waitlist request for "${itemName}" received`,
      html: renderBrandedEmail({
        title: "Waitlist Confirmation",
        content: `
          <p>Hi ${parentName || "there"},</p>
          <p>
            You have been added to the waitlist for
            <strong>${itemName}</strong>
            ${childName ? `for ${childName}` : ""}.
          </p>
          <p>
            We will contact you as soon as this toy becomes available.
          </p>
        `,
      }),
    });

    if (process.env.ADMIN_EMAIL) {
      await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: `New waitlist request: "${itemName}"`,
        html: `
          <h3>New Waitlist Entry</h3>
          <p><strong>Parent:</strong> ${parentName || "N/A"} (${parentEmail})</p>
          <p><strong>Child:</strong> ${childName || "N/A"}</p>
          <p><strong>Item:</strong> ${itemName}</p>
        `,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Waitlist email error:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

/* ======================================================
   ROUTE: Status Updated
   ❌ NO email when status = "On Loan"
====================================================== */
app.post("/email/status-updated", async (req, res) => {
  try {
    const {
      parentEmail,
      parentName,
      childName,
      itemName,
      newStatus,
      preferredDay,
    } = req.body;

    if (!parentEmail || !itemName || !newStatus) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ❌ Skip On Loan emails
    if (newStatus === "On Loan") {
      return res.json({ skipped: true });
    }

    let subject = `Update for "${itemName}"`;
    let html = "";

    if (newStatus === "Ready for Pickup") {
      subject = `🎉 "${itemName}" is ready for pickup`;
      html = renderBrandedEmail({
        title: "Your Toy is Ready for Pickup",
        showPickupInfo: true,
        content: `
          <p>Hi ${parentName || "there"},</p>
          <p>
            Great news! <strong>${itemName}</strong>
            ${childName ? `for ${childName}` : ""} is now
            <strong>ready for pickup</strong>.
          </p>
          ${
            preferredDay
              ? `<p>You requested pickup on <strong>${preferredDay}</strong>.</p>`
              : ""
          }
          <h4>Note: You will be required to show this confirmationemail with you when you come.</h4>
        `,
      });
    } else if (newStatus === "Returned") {
      html = renderBrandedEmail({
        title: "Thank You",
        content: `
          <p>Hi ${parentName || "there"},</p>
          <p>
            We have marked <strong>${itemName}</strong> as
            <strong>Returned</strong>.
          </p>
          <p>Thank you for using the Toy Lending Library!</p>
        `,
      });
    }

    await sendEmail({ to: parentEmail, subject, html });
    res.json({ ok: true });
  } catch (err) {
    console.error("Status email error:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

/* ===============================
   START SERVER
================================ */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`📧 Email service running on port ${PORT}`);
});

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cron = require("node-cron");

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const SLACK_TOKEN = process.env.TOKEN;
const CHANNEL = process.env.CHANNEL;

const horarios = [
  "9:30 - 10:00",
  "12:00 - 12:30",
  "2:30 - 3:00",
  "5:00 - 5:30",
  "7:30 - 8:00",
  "10:00 - 10:30",
  "12:00",
];

// =================
// BLOQUES UI
// =================
function generarBloques(data) {
  let blocks = [];

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "📋 *BVB Checks del día*" },
  });

  for (let h of horarios) {
    let text = `⏰ *${h}*\n`;

    if (!data[h] || !data[h].takenBy) {
      text += "_Disponible_";
    } else {
      text += `🟢 Taken by @${data[h].takenBy}\n`;
      if (data[h].doneBy) {
        text += `✅ Done by @${data[h].doneBy}`;
      }
    }

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });

    if (!data[h] || !data[h].takenBy) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Take" },
            action_id: `take_${h}`,
          },
        ],
      });
    } else if (!data[h].doneBy) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Done" },
            action_id: `done_${h}`,
          },
        ],
      });
    }

    blocks.push({ type: "divider" });
  }

  return blocks;
}

// =================
// CRON 9AM COLOMBIA
// =================
cron.schedule(
  "0 9 * * *",
  async () => {
    const fecha = new Date().toISOString().slice(0, 10);

    // 🚫 evitar duplicados
    const doc = await db.collection("bvb-checks").doc(fecha).get();
    if (doc.exists && doc.data().thread_ts) {
      console.log("⚠️ Ya enviado hoy");
      return;
    }

    const parent = await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: CHANNEL,
        text: "📋 BVB Checks del día",
      },
      {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      }
    );

    const thread_ts = parent.data.ts;

    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: CHANNEL,
        thread_ts,
        blocks: generarBloques({}),
      },
      {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      }
    );

    await db.collection("bvb-checks").doc(fecha).set({
      thread_ts,
    });
  },
  { timezone: "America/Bogota" }
);

// =================
// INTERACCIONES
// =================
app.post("/slack/interactions", async (req, res) => {
  // 🔥 RESPUESTA INMEDIATA
  res.status(200).send();

  try {
    const payload = JSON.parse(req.body.payload);
    const action = payload.actions[0];

    const user = payload.user.username;
    const actionId = action.action_id;
    const horario = actionId.replace("take_", "").replace("done_", "");

    const fecha = new Date().toISOString().slice(0, 10);
    const hoy = fecha;

    const ref = db.collection("bvb-checks").doc(fecha);
    const doc = await ref.get();

    let data = doc.exists ? doc.data() : {};
    const thread_ts = data.thread_ts;

    if (!data[horario]) data[horario] = {};

    // =================
    // TAKE
    // =================
    if (actionId.startsWith("take_")) {
      if (!data[horario].takenBy) {
        data[horario].takenBy = user;

        await axios.post(
          "https://slack.com/api/chat.postMessage",
          {
            channel: CHANNEL,
            thread_ts,
            text: `🟢 @${user} tomó *${horario}*`,
          },
          {
            headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
          }
        );
      }
    }

    // =================
    // DONE
    // =================
    if (actionId.startsWith("done_")) {
      if (!data[horario].doneBy) {
        data[horario].doneBy = user;

        await axios.post(
          "https://slack.com/api/chat.postMessage",
          {
            channel: CHANNEL,
            thread_ts,
            text: `✅ @${user} completó *${horario}*`,
          },
          {
            headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
          }
        );
      }
    }

    // 🔒 guardar
    await ref.set(data, { merge: true });

    // =================
    // SOLO ACTUALIZAR HOY
    // =================
    const mensajeFecha = new Date(payload.message.ts * 1000)
      .toISOString()
      .slice(0, 10);

    if (mensajeFecha === hoy) {
      await axios.post(
        "https://slack.com/api/chat.update",
        {
          channel: CHANNEL,
          ts: payload.message.ts,
          blocks: generarBloques(data),
        },
        {
          headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
        }
      );
    }

  } catch (err) {
    console.error("❌ Error:", err);
  }
});

// =================
app.listen(10000, () => {
  console.log("🚀 Server listo");
});